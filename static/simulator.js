const $=(selector,root=document)=>root.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const now=()=>Date.now()/1000;
const stamp=value=>value?new Date(value*1000).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'}):'Not yet';

let token,device,state,syncing=false,timer,lastSync=0,lastError='';

async function request(body) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);
  try {
    const response=await fetch('/api/gateway/sync',{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
    const result=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(result.error||`Request failed (${response.status})`);
    return result;
  } finally {clearTimeout(timeout);}
}

function save() {
  sessionStorage.setItem(`loomcare.lab.${device.id}`,JSON.stringify(state));
}

function addLog(message,tone='info') {
  state.logs.unshift({message,tone,at:now()});
  state.logs=state.logs.slice(0,16);
  save();
}

function severity(kind) {
  if(['fall','sos'].includes(kind)) return 'critical';
  if(['low_battery','disconnected','device_fault','missed'].includes(kind)) return 'warning';
  return 'informational';
}

function preview(kind,label) {
  state.preview={kind,label,severity:severity(kind),at:now(),delivery:state.offline?'Queued on gateway':'Sending to server'};
  save();render();
}

async function enqueue(kind,ref='') {
  const event={id:crypto.randomUUID(),kind,ref,occurred_at:now()};
  state.queue.push(event);
  preview(kind,{fall:'Possible fall detected',sos:'SOS pressed',fall_cancelled:'Fall warning cancelled',checkin_ack:'Check-in answered'}[kind]||kind.replaceAll('_',' '));
  addLog(`${kind.replaceAll('_',' ')} stored on the simulated gateway`,state.offline?'warn':'info');
  await sync();
}

async function sync() {
  if(syncing||state.offline||!navigator.onLine) return render();
  syncing=true;render();
  const sent=state.queue.slice(0,32);
  const receipts=[...state.receipts];
  try {
    const result=await request({events:sent,commands_received:receipts,connected:state.connected,battery:state.battery,charging:state.charging,sensor_ok:true,clock_ok:true,queue_overflow:0,firmware:'locket-lab/1.0'});
    const accepted=new Set(result.accepted);
    state.queue=state.queue.filter(event=>!accepted.has(event.id));
    state.receipts=state.receipts.filter(id=>!receipts.includes(id));
    for(const command of result.commands) {
      if(!state.prompts.some(prompt=>prompt.ref===command.event_id)) state.prompts.push({kind:'checkin',ref:command.event_id,expires:command.expires_at});
      if(!state.receipts.includes(command.id)) state.receipts.push(command.id);
    }
    if(sent.length&&state.preview) state.preview.delivery='Accepted by server';
    lastSync=now();lastError='';
    save();
  } catch(error) {
    lastError=error.name==='AbortError'?'Server did not respond':error.message;
    addLog(`${lastError}; events remain queued`,'warn');
  } finally {syncing=false;render();}
}

function connectionLabel() {
  if(state.offline) return ['Internet paused','warning'];
  if(!state.connected) return ['Locket out of range','warning'];
  return ['Connected','ok'];
}

function render() {
  if(!device||!$('#lab-root')) return;
  const [connection,connectionTone]=connectionLabel();
  const warning=state.preview?.severity==='warning',critical=state.preview?.severity==='critical';
  const attention=critical?'Critical alert':warning?'Needs attention':'No active critical alert';
  const familyTone=critical?'critical':warning?'warning':'ok';
  const remain=state.cancelUntil?Math.max(0,Math.ceil(state.cancelUntil-now())):0;
  $('#lab-root').innerHTML=`
    <header class="lab-header"><a class="brand" href="/family"><img src="/static/icon.svg" alt="">LOOM<span>CARE</span></a><div><span class="pill">Locket Lab</span> <span class="pill ${connectionTone==='warning'?'amber':''}">${esc(connection)}</span></div></header>
    <main class="lab-main">
      <div class="lab-intro"><div><div class="eyebrow">REAL WORKFLOW SIMULATOR</div><h1>See every surface react.</h1><p>Events use the real gateway API. The phone and operations previews explain the expected UX while your open family and team tabs receive server-confirmed changes.</p></div><div class="toolbar"><a class="btn" href="/family" target="_blank">Open family app ↗</a><a class="btn" href="/team" target="_blank">Open team dashboard ↗</a><button class="btn ghost" id="change-pairing">Change pairing</button></div></div>
      <div class="lab-grid">
        <section class="lab-device">
          <div class="lab-device-head"><div><small>SIMULATED LOCKET</small><h2>${esc(device.name)}</h2></div><span class="lab-led ${critical?'danger':warning?'warn':''}"></span></div>
          <div class="locket" aria-label="Virtual LOOMCARE locket"><div class="locket-light ${critical?'danger':warning?'warn':''}"></div><div class="locket-button"></div><span>LOOMCARE</span></div>
          <div class="lab-readout"><span>Battery</span><strong>${state.battery}%</strong><span>Gateway queue</span><strong>${state.queue.length}</strong></div>
          ${remain?`<div class="lab-local-alert"><strong>Possible fall · local warning</strong><b>${remain}s</b><span>No cloud alert yet. The wearer may cancel.</span></div>`:''}
          ${state.prompts.length?`<div class="notice"><strong>Family check-in waiting.</strong> The parent can respond using the locket button.</div>`:''}
          <button class="btn primary big-action" id="respond" ${!remain&&!state.prompts.length?'disabled':''}>I’m okay / acknowledge</button>
        </section>
        <section class="lab-console">
          <div><div class="eyebrow">SCENARIOS</div><h2>Trigger a real care journey</h2><p>Critical events reach the contact workflow. Connection-loss family alerts respect the configured silence window.</p></div>
          <div class="scenario-grid">
            <button class="scenario critical" data-scenario="fall"><b>Possible fall</b><span>15-second local cancel window</span></button>
            <button class="scenario critical" data-scenario="sos"><b>SOS press</b><span>Immediate critical event</span></button>
            <button class="scenario warning" data-scenario="battery"><b>Low battery</b><span>12% telemetry and warning</span></button>
            <button class="scenario warning" data-scenario="connection"><b>${state.connected?'Lose connection':'Restore connection'}</b><span>${state.connected?'Team sees silence first':'Resume heartbeats'}</span></button>
            <button class="scenario" data-scenario="network"><b>${state.offline?'Restore internet':'Pause internet'}</b><span>${state.offline?'Replay queued events':'Events remain on gateway'}</span></button>
            <button class="scenario" data-scenario="recover"><b>Recover device</b><span>90% battery and connected</span></button>
          </div>
          <div class="lab-sync"><span><i class="dot ${lastError?'bad':''}"></i>${lastError?esc(lastError):syncing?'Synchronizing…':state.offline?'Cloud intentionally paused':'Cloud connected'}</span><small>Last accepted ${esc(stamp(lastSync))}</small></div>
        </section>
        <section class="surface-preview phone-preview">
          <div class="preview-bar"><span>9:41</span><b>Family app</b><span>●●●</span></div>
          <div class="preview-body"><small>HOME</small><h3>${esc(attention)}</h3><p>Here’s what ${esc(device.name)}’s locket last reported.</p>
            <div class="preview-status ${familyTone}"><span>${critical?'!':warning?'△':'✓'}</span><div><strong>${esc(state.preview?.label||connection)}</strong><small>${state.preview?`${esc(state.preview.delivery)} · ${esc(stamp(state.preview.at))}`:`Last synchronized ${esc(stamp(lastSync))}`}</small></div></div>
            <div class="preview-metrics"><div><span>Connection</span><b>${esc(connection)}</b></div><div><span>Battery</span><b>${state.battery}%</b></div></div>
            ${critical?'<button class="preview-action">Acknowledge after checking</button><small class="preview-note">Call the parent or arrange an in-person check first.</small>':'<div class="preview-nav"><b>Home</b><span>Activity</span><span>Alerts</span><span>Profile</span></div>'}
          </div>
        </section>
        <section class="surface-preview ops-preview">
          <div class="preview-bar"><b>Operations</b><span>Fleet monitor</span></div>
          <div class="ops-kpis"><div><span>Connection</span><b>${esc(connection)}</b></div><div><span>Open alert</span><b>${critical?'1':'0'}</b></div><div><span>Queue</span><b>${state.queue.length}</b></div></div>
          <div class="ops-row"><span class="status-dot ${critical?'critical':warning?'warning':'ok'}"></span><div><strong>${esc(device.name)}</strong><small>${esc(state.preview?.label||'No active incident')} · last sync ${esc(stamp(lastSync))}</small></div><span class="pill ${critical?'red':warning?'amber':''}">${critical?'Critical':warning?'Warning':'Watching'}</span></div>
          <div class="notice ${state.connected?'':'warning'}">${state.connected?'Operations can see current gateway health and notification delivery separately.':'The team sees reduced protection immediately. The family disconnection alert waits for the household grace window.'}</div>
        </section>
      </div>
      <section class="card lab-log"><div class="row"><div><h2>Scenario journal</h2><p>“Stored” is not the same as server accepted or human acknowledged.</p></div><span class="pill">${state.queue.length} queued</span></div><div>${state.logs.map(item=>`<div class="journal-row"><span class="status-dot ${item.tone}"></span><span>${esc(item.message)}</span><small>${esc(stamp(item.at))}</small></div>`).join('')||'<p>No scenarios triggered yet.</p>'}</div></section>
      <p class="bottom-note">Simulation only. It does not validate physical sensors, BLE range, battery accuracy, background reliability or fall-detection performance.</p>
    </main>`;
  $('#change-pairing').onclick=reset;
  $('#respond').onclick=async()=>{
    if(state.cancelUntil){state.cancelUntil=null;await enqueue('fall_cancelled');}
    else if(state.prompts.length){const prompt=state.prompts.shift();await enqueue('checkin_ack',prompt.ref);}
    save();render();
  };
  document.querySelectorAll('[data-scenario]').forEach(button=>button.onclick=()=>run(button.dataset.scenario));
}

async function run(scenario) {
  if(scenario==='fall') {
    if(state.cancelUntil) return;
    state.cancelUntil=now()+15;preview('fall_pending','Possible fall · cancellation window');addLog('Candidate fall started locally; cloud not alerted yet','warn');
  } else if(scenario==='sos') {
    state.cancelUntil=null;await enqueue('sos');
  } else if(scenario==='battery') {
    state.battery=12;state.charging=false;preview('low_battery','Low battery · charge soon');addLog('Battery telemetry changed to 12%','warn');await sync();
  } else if(scenario==='connection') {
    state.connected=!state.connected;preview('disconnected',state.connected?'Locket connection restored':'Locket out of range');addLog(state.connected?'Locket heartbeat restored':'Locket marked out of range; family grace window started',state.connected?'info':'warn');await sync();
  } else if(scenario==='network') {
    state.offline=!state.offline;addLog(state.offline?'Internet paused; local locket functions continue':'Internet restored; replay started',state.offline?'warn':'info');if(!state.offline) await sync();
  } else if(scenario==='recover') {
    state.battery=90;state.charging=true;state.connected=true;state.offline=false;state.cancelUntil=null;state.preview={kind:'recovered',label:'Locket connected and charging',severity:'informational',at:now(),delivery:'Sending updated telemetry'};addLog('Device recovered: connected, charging and 90% battery');await sync();
  }
  save();render();
}

function reset() {
  sessionStorage.removeItem('loomcare.simulator.token');
  location.reload();
}

function pairingScreen(message='') {
  $('#app').innerHTML=`<div class="lab-pair"><a class="brand" href="/family"><img src="/static/icon.svg" alt="">LOOM<span>CARE</span></a><div class="eyebrow">LOCKET LAB</div><h1>Test the whole care journey.</h1><p>Create a virtual locket and Browser gateway from the family app. Then open its Locket Lab link, or paste the one-time gateway link below.</p>${message?`<div class="notice error">${esc(message)}</div>`:''}<form id="lab-pair-form" class="form card"><label>Gateway link or token<input name="pairing" type="password" required autocomplete="off" placeholder="/simulator#… or token"></label><button class="btn primary" type="submit">Open Locket Lab</button></form><a href="/family">Set up a virtual locket →</a><p class="bottom-note">Pairing links work like passwords. Use test households only.</p></div>`;
  $('#lab-pair-form').onsubmit=event=>{event.preventDefault();const value=String(new FormData(event.target).get('pairing'));sessionStorage.setItem('loomcare.simulator.token',decodeURIComponent(value.includes('#')?value.split('#').pop():value));location.reload();};
}

export async function startSimulator() {
  const fragment=decodeURIComponent(location.hash.slice(1));
  if(fragment){sessionStorage.setItem('loomcare.simulator.token',fragment);history.replaceState(null,'','/simulator');}
  token=sessionStorage.getItem('loomcare.simulator.token');
  if(!token) return pairingScreen();
  try {
    const config=await request();
    device=config.device;
    if(device.mode!=='simulator') return pairingScreen('Locket Lab requires a virtual locket. Use the parent gateway for physical hardware.');
    const stored=sessionStorage.getItem(`loomcare.lab.${device.id}`);
    state=stored?JSON.parse(stored):{battery:86,charging:false,connected:true,offline:false,queue:[],receipts:[],prompts:[],cancelUntil:null,preview:null,logs:[]};
    $('#app').innerHTML='<div id="lab-root"></div>';
    addLog('Locket Lab connected to the real care workflow');
    await sync();render();
    timer=setInterval(async()=>{
      if(state.cancelUntil&&now()>=state.cancelUntil){state.cancelUntil=null;await enqueue('fall');addLog('Cancellation window ended; possible fall sent','critical');}
      if(!state.offline) await sync();
      render();
    },1000);
    window.addEventListener('beforeunload',()=>clearInterval(timer));
  } catch(error) {pairingScreen(error.message);}
}
