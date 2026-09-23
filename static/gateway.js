import {$, esc, api, toast, stamp} from './app.js';

const SERVICE='8be12000-7e34-4b80-8fd8-7277a721e9bc';
const TX='8be12001-7e34-4b80-8fd8-7277a721e9bc';
const RX='8be12002-7e34-4b80-8fd8-7277a721e9bc';
let token, device, db, saved, syncBusy=false, bleDevice, rx, connected=false, offline=false, receiveBuffer='', writeChain=Promise.resolve(), configAck='', desiredConfig='', lastConfigSend=0, lastClockSend=0, lastSuccess=0, lastError='', lastHeartbeat=0;
let physicalStatus={battery:null,charging:null,sensor_ok:null,clock_ok:null,queue_overflow:0,firmware:'ESP32 · awaiting telemetry'};
let logs=[];
const now=()=>Date.now()/1000;
function openDB() {
  return new Promise((resolve,reject)=>{const req=indexedDB.open('loomcare-gateway-v1',1);req.onupgradeneeded=()=>req.result.createObjectStore('state');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
}
function storage(value) {
  return new Promise((resolve,reject)=>{const tx=db.transaction('state',value===undefined?'readonly':'readwrite');const store=tx.objectStore('state');const req=value===undefined?store.get(device.id):store.put(value,device.id);tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || new Error('Local storage is unavailable.'));});
}
const persist=()=>storage(saved);
function log(message) {logs.unshift(`${new Date().toLocaleTimeString()}  ${message}`);logs=logs.slice(0,20);render();}
async function send(command) {
  writeChain=writeChain.catch(()=>{}).then(async()=>{
    if(!rx || !bleDevice?.gatt.connected) throw new Error('Pendant not connected.');
    const bytes=new TextEncoder().encode(JSON.stringify(command)+'\n');
    for(let i=0;i<bytes.length;i+=20) await rx.writeValueWithResponse(bytes.slice(i,i+20));
  });
  return writeChain;
}
async function enqueue(kind,ref='',sourceId=null,occurred=now()) {
  if(saved.queue.some(e=>e.id===sourceId)) return;
  if(saved.queue.length>=256) throw new Error('Gateway queue is full (256 events). Restore connectivity before continuing.');
  saved.queue.push({id:sourceId || crypto.randomUUID(),kind,ref,occurred_at:occurred});
  await persist();log(`${kind.replaceAll('_',' ')} stored locally`);render();void sync();
}
function render() {
  if(!$('#gateway-status') || !device) return;
  const isPhysical=device.mode==='physical';
  $('#gateway-status').innerHTML=`<span class="pill ${connected?'':'amber'}">${connected?(isPhysical?'Bluetooth connected':'Simulator running'):'Pendant disconnected'}</span> <span class="pill ${offline || lastError?'amber':''}">${offline?'Internet paused':lastError?'Server unavailable':lastSuccess?'Cloud connected':'Connecting to cloud'}</span>`;
  $('#queue-count').textContent=String(saved.queue.length);
  $('#gateway-last-sync').textContent=stamp(lastSuccess);
  $('#gateway-error').textContent=lastError;
  $('#gateway-log').textContent=logs.join('\n') || 'Ready. Events remain on this device until the server accepts them.';
  $('#pause-network').textContent=offline?'Restore internet':'Simulate internet loss';
  if($('#battery-value')) $('#battery-value').textContent=isPhysical?(physicalStatus.battery==null?'Unknown':`${physicalStatus.battery}%`):`${saved.battery}%`;
  const remain=saved.cancelUntil?Math.max(0,Math.ceil(saved.cancelUntil-now())):0;
  $('#local-warning').innerHTML=remain?`<div class="notice error"><h3>Possible fall · local warning</h3><div class="countdown">${remain}s</div><p>Press “I’m okay” to cancel before the event is sent.</p></div>`:'';
  $('#pending-prompts').innerHTML=saved.prompts.length?saved.prompts.map(p=>`<div class="notice spaced"><strong>${p.kind==='checkin'?'Your family is checking in':esc(p.label || 'Medication reminder')}</strong><br>Press the confirmation button. Expires ${esc(stamp(p.expires))}.</div>`).join(''):'<p>No reminder or check-in waiting.</p>';
  $('#confirm-button').disabled=isPhysical || (!remain && !saved.prompts.length);
  if($('#fall-button')) $('#fall-button').disabled=!!remain;
}
async function sync() {
  if(syncBusy || offline || !navigator.onLine || !device) return;
  syncBusy=true;
  const events=saved.queue.slice(0,32), receipts=[...saved.receipts];
  try {
    const status=device.mode==='physical'?physicalStatus:{battery:saved.battery,charging:saved.charging,sensor_ok:true,clock_ok:true,queue_overflow:0,firmware:'virtual-pendant/1.0'};
    const result=await api('/api/gateway/sync',{events,commands_received:receipts,connected,...status},'POST',{Authorization:`Bearer ${token}`});
    const accepted=new Set(result.accepted);
    saved.queue=saved.queue.filter(e=>!accepted.has(e.id));
    saved.receipts=saved.receipts.filter(id=>!receipts.includes(id));
    saved.reminders=result.reminders;
    if(device.mode==='simulator') saved.prompts=saved.prompts.filter(p=>p.kind==='checkin' || result.reminders.some(r=>r.enabled && p.ref.startsWith(r.id+':')));
    lastSuccess=now();lastHeartbeat=now();lastError='';
    if(device.mode==='simulator') {
      for(const command of result.commands) {
        if(!saved.prompts.some(p=>p.ref===command.event_id)) saved.prompts.push({kind:'checkin',ref:command.event_id,expires:command.expires_at});
        if(!saved.receipts.includes(command.id)) saved.receipts.push(command.id);
      }
    }
    await persist();
    if(device.mode==='physical' && connected) {
      for(const id of accepted) await send({op:'ack',id});
      if(now()-lastClockSend>60) {await send({op:'time',epoch:Math.floor(result.now)});lastClockSend=now();}
      desiredConfig=JSON.stringify(result.reminders.map(r=>[r.id,r.minute,r.enabled]));
      if(configAck!==desiredConfig && now()-lastConfigSend>10) {
        lastConfigSend=now();
        await send({op:'begin',version:await digest(desiredConfig),count:result.reminders.length});
        for(const r of result.reminders) await send({op:'reminder',id:r.id,minute:r.minute,enabled:!!r.enabled});
        await send({op:'commit'});
      }
      for(const command of result.commands) await send({op:'checkin',id:command.id,ref:command.event_id,expires:Math.floor(command.expires_at)});
    }
  } catch(e) {lastError=e.message;}
  finally {syncBusy=false;render();}
}
async function digest(value) {
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash).slice(0,8),b=>b.toString(16).padStart(2,'0')).join('');
}
let notificationChain=Promise.resolve();
function onNotification(event) {
  receiveBuffer+=new TextDecoder().decode(event.target.value);
  if(receiveBuffer.length>4096) {receiveBuffer='';lastError='Malformed Bluetooth frame discarded.';return;}
  let index;
  while((index=receiveBuffer.indexOf('\n'))>=0) {
    const line=receiveBuffer.slice(0,index);receiveBuffer=receiveBuffer.slice(index+1);
    notificationChain=notificationChain.then(async()=>{
      const message=JSON.parse(line);
      if(message.kind==='status') {
        physicalStatus={battery:message.battery ?? null,charging:message.charging ?? null,sensor_ok:message.sensor_ok,clock_ok:message.clock_ok,queue_overflow:message.queue_overflow || 0,firmware:message.firmware || 'ESP32'};
        render();
      } else if(message.kind==='receipt') {
        if(!saved.receipts.includes(message.ref)) saved.receipts.push(message.ref);
        await persist();void sync();
      } else if(message.kind==='config_received') {
        if(message.ref===await digest(desiredConfig)) {configAck=desiredConfig;log('Daily schedules confirmed by pendant');}
      } else if(message.kind==='local_warning') {
        log('Pendant fall cancellation window active');
      } else if(message.id && message.kind) {
        await enqueue(message.kind,message.ref || '',String(message.id),message.at || null);
      }
    }).catch(e=>{lastError=e.message;render();});
  }
}
async function connectBluetooth() {
  if(!navigator.bluetooth) throw new Error('Web Bluetooth requires Chrome on Android or a supported desktop, over HTTPS or localhost. iOS Safari is not supported.');
  bleDevice=await navigator.bluetooth.requestDevice({filters:[{services:[SERVICE]}]});
  bleDevice.addEventListener('gattserverdisconnected',()=>{connected=false;rx=null;configAck='';log('Bluetooth disconnected. Local pendant functions continue.');void sync();});
  const server=await bleDevice.gatt.connect();
  const service=await server.getPrimaryService(SERVICE);
  rx=await service.getCharacteristic(RX);
  const tx=await service.getCharacteristic(TX);
  tx.addEventListener('characteristicvaluechanged',onNotification);
  await tx.startNotifications();
  connected=true;configAck='';lastConfigSend=0;lastClockSend=0;
  log(`Connected to ${bleDevice.name || 'LOOMCARE pendant'}`);await sync();
}
async function simulateTick() {
  if(!saved || device.mode!=='simulator') return;
  let changed=false;
  if(saved.cancelUntil && now()>=saved.cancelUntil) {
    saved.cancelUntil=null;await enqueue('fall');changed=true;
  }
  const today=Math.floor((now()+19800)/86400);
  for(const reminder of saved.reminders) {
    const due=today*86400-19800+reminder.minute*60;
    const ref=`${reminder.id}:${today}`;
    if(reminder.enabled && now()>=due && now()<due+300 && saved.fired[reminder.id]!==today) {
      saved.fired[reminder.id]=today;saved.prompts.push({kind:'reminder',ref,expires:due+300,label:reminder.label});changed=true;log('Local medication reminder started');
    }
  }
  const active=saved.prompts.filter(p=>p.expires>now());
  if(active.length!==saved.prompts.length) {saved.prompts=active;changed=true;}
  if(changed) await persist();render();
}
export async function startGateway() {
  const fragment=decodeURIComponent(location.hash.slice(1));
  if(fragment) {sessionStorage.setItem('loomcare.gateway.token',fragment);history.replaceState(null,'','/gateway');}
  token=sessionStorage.getItem('loomcare.gateway.token');
  if(!token) {
    $('#app').innerHTML=`<div class="gateway-body spaced"><h1>The parent’s quiet connection.</h1><p class="spaced">Open the pairing link from your family app, or paste it below. No family password is stored here.</p><form id="pair-form" class="form card spaced"><label>Gateway pairing link<input name="link" type="password" required autocomplete="off"></label><button class="btn primary" type="submit">Pair this gateway</button></form><a href="/family">Back to family app</a></div>`;
    $('#pair-form').onsubmit=event=>{event.preventDefault();const value=new FormData(event.target).get('link');sessionStorage.setItem('loomcare.gateway.token',value.includes('#')?value.split('#').pop():value);location.reload();};return;
  }
  try {
    const config=await api('/api/gateway/sync',undefined,'GET',{Authorization:`Bearer ${token}`});
    device=config.device;db=await openDB();saved=await storage() || {queue:[],receipts:[],prompts:[],reminders:[],fired:{},battery:85,charging:false,cancelUntil:null};saved.reminders=config.reminders;await persist();
  } catch(e) {
    $('#app').innerHTML=`<div class="gateway-body spaced"><h2>Gateway could not connect</h2><p>${esc(e.message)}</p><p>Reconnect to the server to open a new gateway session. Once open, simulator events and physical pendant events can queue through internet loss.</p><button id="retry" class="btn primary spaced">Retry</button><button id="reset" class="btn spaced">Use another pairing link</button></div>`;
    $('#retry').onclick=()=>location.reload();$('#reset').onclick=()=>{sessionStorage.removeItem('loomcare.gateway.token');location.reload();};return;
  }
  connected=device.mode==='simulator';
  const physical=device.mode==='physical';
  $('#app').innerHTML=`<header class="gateway-top row"><a href="/family" class="brand"><img src="/static/icon.svg" alt="">LOOM<span>CARE</span></a><span class="pill">Parent-side gateway</span></header><main class="gateway-body"><div class="page-heading"><div class="eyebrow">A simple, physical experience</div><h1>${esc(device.name)}’s pendant</h1><p>Local care continues. The gateway carries the updates.</p></div><div class="notice warning">Keep this page open and the phone awake for prototype testing. Background Bluetooth and locked-screen delivery are not guaranteed. ${physical?'Pair using the six-digit PIN you chose during first-boot USB setup.':'This is a virtual pendant, not a real fall detector.'}</div><div id="gateway-status" class="spaced"></div><div class="two-col spaced"><section class="gateway-device"><h2>${physical?'Physical pendant':'Virtual pendant'}</h2><div class="pendant" aria-hidden="true"><i></i></div><p>${physical?'Use the physical button on the pendant. Hold for two seconds for SOS.':'Tap to acknowledge or cancel. SOS bypasses fall cancellation.'}</p>${physical?'<button id="connect-ble" class="btn primary big-action">Connect Bluetooth pendant</button>':'<button id="confirm-button" class="btn big-action">I’m okay / acknowledge</button><button id="sos-button" class="btn danger big-action">Hold-to-SOS simulation</button>'}<small>Battery estimate: <span id="battery-value">Unknown</span></small></section><section class="stack"><div id="local-warning"></div><div class="card"><h3>Waiting for a button press</h3><div id="pending-prompts" class="spaced"></div>${physical?'<button id="confirm-button" class="hidden" disabled>Physical button only</button>':''}</div><div class="card"><h3>Prototype controls</h3><div class="toolbar spaced">${!physical?'<button id="fall-button" class="btn">Simulate possible fall</button><button id="low-battery" class="btn">Battery 12%</button><button id="charge" class="btn">Charge / recover</button>':''}<button id="pause-network" class="btn">Simulate internet loss</button></div><p class="spaced"><small>Queued events: <b id="queue-count">0</b> / 256 · Last cloud sync: <span id="gateway-last-sync">Never</span></small></p><p id="gateway-error" class="form-error" role="alert"></p></div></section></div><section class="card spaced"><h3>Gateway activity</h3><pre id="gateway-log" class="gateway-log"></pre></section><p class="bottom-note">Events are cached in IndexedDB until accepted by the server. Clock policy: IST daily schedules. Cloud accepts up to seven days of replay. Do not clear browser storage while events are queued.</p></main>`;
  const safe=fn=>async()=>{try{await fn();}catch(e){toast(e.message);lastError=e.message;render();}};
  $('#pause-network').onclick=safe(async()=>{offline=!offline;log(offline?'Internet paused; local functions remain active':'Internet restored; replaying queued events');await sync();render();});
  if(physical) $('#connect-ble').onclick=safe(connectBluetooth);
  else {
    $('#fall-button').onclick=safe(async()=>{saved.cancelUntil=now()+15;await persist();log('Possible fall: 15-second local cancellation window');render();});
    $('#sos-button').onclick=safe(async()=>{saved.cancelUntil=null;await enqueue('sos');});
    $('#confirm-button').onclick=safe(async()=>{
      if(saved.cancelUntil) {saved.cancelUntil=null;await enqueue('fall_cancelled');}
      else if(saved.prompts.length) {const prompt=saved.prompts[0];await enqueue(prompt.kind==='checkin'?'checkin_ack':'reminder_ack',prompt.ref);saved.prompts.shift();await persist();}
      render();
    });
    $('#low-battery').onclick=safe(async()=>{saved.battery=12;saved.charging=false;await persist();await sync();});
    $('#charge').onclick=safe(async()=>{saved.battery=90;saved.charging=true;await persist();await sync();});
  }
  render();await sync();
  let ticking=false;
  setInterval(async()=>{if(ticking)return;ticking=true;try{await simulateTick();if(now()-lastHeartbeat>=5 || saved.queue.length || saved.receipts.length) await sync();}catch(e){lastError=e.message;render();}finally{ticking=false;}},1000);
  let wakeLock;
  const resume=async()=>{
    if(document.hidden) return;
    await sync();await simulateTick();
    if('wakeLock' in navigator && (!wakeLock || wakeLock.released)) {
      try{wakeLock=await navigator.wakeLock.request('screen');}catch{log('Screen wake lock unavailable; keep this page awake manually.');}
    }
  };
  window.addEventListener('online',()=>{void resume();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void resume();});
  window.addEventListener('focus',()=>{void resume();});
  window.addEventListener('beforeunload',event=>{if(saved.queue.length){event.preventDefault();event.returnValue='';}});
  await resume();
}
