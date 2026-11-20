export const $ = (selector, root = document) => root.querySelector(selector);
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
export const stamp = value => value ? new Date(value * 1000).toLocaleString('en-IN', {timeZone:'Asia/Kolkata', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}) : 'Not yet';
export const ago = value => !value ? 'Never connected' : Date.now() / 1000 - value < 60 ? 'Just now' : `${Math.floor((Date.now() / 1000 - value) / 60)} min ago`;
const span = s => s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
export function toast(message) {
  const box = $('#toast'); box.textContent = message; box.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.remove('show'), 5000);
}
export function modal(title, body, submit) {
  const dialog = $('#modal');
  dialog.innerHTML = `<button class="btn ghost close" aria-label="Close dialog" data-close>×</button><h2 id="dialog-title">${esc(title)}</h2>${body}`;
  dialog.querySelectorAll('[data-close]').forEach(b => b.onclick = () => dialog.close());
  if ($('form', dialog)) $('form', dialog).onsubmit = async event => {
    event.preventDefault();
    const button = $('button[type=submit]', dialog), error = $('.form-error', dialog);
    if (button) button.disabled = true;
    try { await submit(Object.fromEntries(new FormData(event.target)), dialog); }
    catch (e) { if (error) error.textContent = e.message; else toast(e.message); }
    finally { if (button?.isConnected) button.disabled = false; }
  };
  if (!dialog.open) dialog.showModal();
}
let csrf, account, data, metrics, extra, currentSignature, notified = new Set(), loadedNotifications = false;
const page = location.pathname;
const params = new URLSearchParams(location.search);
const view = params.get('view') || 'overview';
const team = page === '/team';
const RANK = {viewer:0, caregiver:1, owner:2};
const can = min => RANK[data?.me?.household_role || 'viewer'] >= RANK[min];
const admin = () => account?.team_role === 'admin';
export async function api(path, body, method = 'POST', headers = {}) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(path, {method:body === undefined ? 'GET' : method, credentials:'same-origin', headers:{'Content-Type':'application/json', 'X-CSRF-Token':csrf || '', ...headers}, body:body === undefined ? undefined : JSON.stringify(body), signal:controller.signal});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
    return result;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The server did not respond. Your event can be retried safely.');
    throw e;
  } finally { clearTimeout(timeout); }
}
const brand = `<a href="/family" class="brand"><img src="/static/icon.svg" alt="">LOOM<span>CARE</span></a>`;
const art = `<div class="hero-art" aria-hidden="true"><div class="orbit"></div><div class="orbit two"></div><div class="pendant"><i></i></div><div class="floating-tag">A simple connection. A little closer.</div></div>`;
const pill = (label, style='') => `<span class="pill ${style}">${esc(label)}</span>`;
const title = (heading, subtitle, action='') => `<div class="row page-heading"><div><h1>${heading}</h1><p>${subtitle}</p></div>${action}</div>`;
const empty = (heading, subtitle) => `<div class="empty"><strong>${heading}</strong>${subtitle}</div>`;
const formFooter = (label='Save') => `<p class="form-error" role="alert"></p><button class="btn primary" type="submit">${label}</button>`;
const table = (head, rows, none) => rows.length ? `<div class="table-wrap"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : none;
const KIND = {web:'Browser', phone:'Phone app', hub:'Home Hub'};
const ROLE_HELP = {owner:'Manages parents, gateways and members', caregiver:'Reminders, contacts, check-ins and alerts', viewer:'Sees updates and can acknowledge alerts'};
function shell() {
  const base = team ? '/team' : '/family';
  const links = team ? [['overview','Overview','◫'],['incidents','Incident desk','!'],['customers','Customers','◎'],['fleet','Fleet & gateways','⌁'],['inventory','Inventory','▦'],['delivery','Delivery monitor','↗'],['audit','Audit trail','≡'],...(admin()?[['team','Team','☺']]:[])] : [['overview','Home','◫'],['alerts','Alerts','!'],['activity','Activity','≡'],['reminders','Reminders','◷'],['contacts','Care contacts','◎'],['circle','Profile & Care Circle','☺']];
  const current = view === 'household' ? 'customers' : view;
  $('#app').innerHTML = `<div class="layout"><aside class="sidebar">${brand}<div class="workspace-label">${team ? 'Team workspace' : 'Your care space'}</div><nav class="nav" aria-label="Main navigation">${links.map(([id,label,icon]) => `<a href="${base}?view=${id}" class="${current===id && page!=='/plan' ? 'active' : ''}"><span class="nav-icon" aria-hidden="true">${icon}</span>${label}</a>`).join('')}<a href="/simulator"><span class="nav-icon" aria-hidden="true">◇</span>Locket Lab</a><a href="/plan" class="${page==='/plan'?'active':''}"><span class="nav-icon" aria-hidden="true">↗</span>V1 rollout plan</a></nav><div class="sidebar-bottom"><div class="support-card"><h3>Made for real life.</h3><p>Test a full care journey with a virtual locket. No hardware needed.</p><a href="/simulator">Open Locket Lab →</a></div><div class="profile"><div class="avatar">${esc(account?.name?.[0] || 'L')}</div><div class="profile-text"><strong>${esc(account?.name || 'Build workspace')}</strong><small>${team ? `Care operations · ${esc(account?.team_role || '')}` : `Family & care${account?.household_role ? ' · ' + esc(account.household_role) : ''}`}</small></div><button class="btn ghost" data-action="logout" aria-label="Sign out">↪</button></div></div></aside><div class="main"><header class="topbar"><span class="breadcrumb">${team?'Operations':'LOOMCARE'} &nbsp; / &nbsp; <b>${esc(page==='/plan'?'rollout plan':current.replace('_',' '))}</b></span><div class="row"><span class="connection" id="connection"><i class="dot"></i> Prototype · connecting</span><button class="btn small" data-action="logout">${account?'Sign out':'Sign in'}</button></div></header><main class="content" id="content"></main></div></div>`;
}
function developerShell() {
  $('#app').innerHTML = `<div class="layout"><aside class="sidebar">${brand}<div class="workspace-label">Developer resources</div><nav class="nav" aria-label="Developer navigation"><a href="/hardware" class="active"><span class="nav-icon" aria-hidden="true">⌘</span>Hardware engineering</a></nav><div class="sidebar-bottom"><div class="support-card"><h3>Internal engineering guide</h3><p>This material is for developers building and validating the locket. It is not part of the customer app.</p></div></div></aside><div class="main"><header class="topbar"><span class="breadcrumb">LOOMCARE engineering &nbsp; / &nbsp; <b>hardware</b></span><div class="row"><span class="connection" id="connection">Developer documentation</span><a class="btn small" href="/family">Open family app</a></div></header><main class="content" id="content"></main></div></div>`;
}
function auth(register=false) {
  $('#app').innerHTML = `<div class="auth"><section class="auth-story">${brand}<h1>Independent lives.<br>A closer connection.</h1><p>A little reassurance for you. A familiar, simple way for your parents to reach out.</p>${art}<small>HOUSEHOLD-FIRST CARE · V1 PROTOTYPE</small></section><section class="auth-form"><div class="eyebrow">${team?'Care operations':'Welcome to your care space'}</div><h2>${team?'Team sign in':register?'Bring your family closer':'Good to have you here.'}</h2><p>${team?'An operator account is provisioned by your administrator.':'Your parents keep their independence. You stay connected.'}</p>${!team?`<div class="auth-tabs"><button data-auth="login" class="${!register?'active':''}">Sign in</button><button data-auth="register" class="${register?'active':''}">Create family account</button></div>`:''}<form id="auth-form" class="form">${register?'<label>Your name<input name="name" required maxlength="80" autocomplete="name" placeholder="Your first name"></label>':''}<label>Email address<input type="email" name="email" required autocomplete="username" placeholder="you@example.com"></label><label>Password<input type="password" name="password" required minlength="12" maxlength="128" autocomplete="${register?'new-password':'current-password'}" placeholder="At least 12 characters"></label>${register?'<label>Invite code (optional)<input name="invite" maxlength="14" autocomplete="off" placeholder="Join an existing family: ABCD-EFGH-JKMN"></label>':''}${formFooter(register?'Create my care space':'Sign in securely')}</form><p class="bottom-note">Prototype only. Not a certified medical device or emergency-response service.</p><div class="row spaced"><a href="${team?'/family':'/team'}">${team?'Family sign in':'Team workspace'} →</a></div></section></div>`;
  document.querySelectorAll('[data-auth]').forEach(button => button.onclick = () => auth(button.dataset.auth==='register'));
  $('#auth-form').onsubmit = async event => {
    event.preventDefault(); const button = $('button[type=submit]', event.target); button.disabled = true;
    const values = Object.fromEntries(new FormData(event.target)); if (!values.invite) delete values.invite;
    try { const result = await api(`/api/${register?'register':'login'}`, values); csrf = result.csrf; location.href = team?'/team':'/family'; }
    catch (e) { $('.form-error').textContent = e.message; button.disabled = false; }
  };
}
function eventLabel(event) {
  return ({fall:'Possible fall',sos:'SOS requested',checkin:'Family check-in',reminder:'Medication reminder',fall_cancelled:'Fall warning cancelled',low_battery:'Time to charge',disconnected:'Pendant out of reach',device_fault:'Device needs attention'})[event.kind] || event.kind;
}
function eventSeverity(event) {
  if (['fall','sos'].includes(event.kind) && ['open','escalated','missed'].includes(event.status)) return 'critical';
  if (['low_battery','disconnected','device_fault'].includes(event.kind) && ['open','escalated','missed'].includes(event.status)) return 'warning';
  if (['checkin','reminder'].includes(event.kind) && event.status==='missed') return 'warning';
  return 'informational';
}
function statusPill(event) {
  const style = ['open','escalated','missed'].includes(event.status) ? (['fall','sos'].includes(event.kind)?'red':'amber') : event.status==='awaiting'?'gray':'';
  return pill(event.status.replaceAll('_',' '), style);
}
function parentName(id) { return data.devices.find(d=>d.id===id)?.name || 'Parent'; }
function eventList(events, limit=6) {
  return events.length ? `<div class="list">${events.slice(0,limit).map(event => {const severity=eventSeverity(event);return `<div class="list-item"><div class="event-icon ${severity==='critical'?'alert':severity==='warning'?'warning':''}">${severity==='critical'?'!':severity==='warning'?'△':'·'}</div><div class="list-body"><strong>${esc(eventLabel(event))} · ${esc(parentName(event.device_id))}</strong><p>${esc(event.kind==='reminder' ? event.note : event.status==='acknowledged' ? 'Response recorded' : event.note || 'Recorded by the care system')}</p>${event.occurred_at && Math.abs(event.received_at-event.occurred_at)>60?`<p>Reported event time: ${esc(stamp(event.occurred_at))} · synced later</p>`:!event.occurred_at && ['fall','sos','device_fault'].includes(event.kind)?'<p>Device time unknown. Check current wellbeing.</p>':''}<div class="healthline">${pill(severity,severity==='critical'?'red':severity==='warning'?'amber':'gray')}${statusPill(event)}${['open','escalated','missed'].includes(event.status) && !['reminder','checkin'].includes(event.kind) ? `<button class="btn small" data-action="ack" data-id="${event.id}">Acknowledge</button>`:''}</div></div><span class="list-time">${esc(stamp(event.received_at))}</span></div>`;}).join('')}</div>` : empty('A quiet care timeline','Check-ins, reminders, and events will appear here.');
}
const linkState = d => d.online ? 'Connected' : d.silent_seconds != null ? `Silent ${span(d.silent_seconds)}` : 'Not connected';
function gatewayChips(deviceId) {
  const list = data.gateways.filter(g => g.device_id === deviceId);
  return list.length ? `<div class="healthline">${list.map(g => pill(`${KIND[g.kind]} · ${g.online ? (g.connected ? 'relaying' : 'pendant not heard') : g.last_seen ? 'offline ' + ago(g.last_seen) : 'never used'}`, g.online && g.connected ? '' : 'gray')).join('')}</div>` : '<p><small>No gateway yet. Add the parent’s phone and, ideally, a Home Hub.</small></p>';
}
function deviceCard(device, index) {
  return `<article class="card"><div class="row"><div class="parent-head"><div class="avatar ${index%2?'alt':''}">${esc(device.name[0])}</div><div><h3>${esc(device.name)}</h3><small>${device.mode==='simulator'?'Virtual pendant':'XIAO nRF54L15 pendant'} · ${device.id.slice(0,6).toUpperCase()}</small></div></div>${pill(linkState(device),device.online?'':'gray')}</div><div class="device-stats"><div><span>Battery estimate</span><strong>${device.battery==null?'Unknown':Math.round(device.battery)+'%'}${device.charging?' · power in':''}</strong></div><div><span>Last heard</span><strong>${esc(ago(device.last_seen))}</strong></div><div><span>Family alert if silent</span><strong>${span(device.offline_alert_seconds)}</strong></div></div>${gatewayChips(device.id)}${device.sensor_ok===0?'<div class="notice error">Motion sensor fault. Fall detection is unavailable.</div>':''}${device.clock_ok===0?'<div class="notice warning">Clock is not set. Local reminders are unavailable.</div>':''}${device.queue_overflow?'<div class="notice error">Device queue overflow reported. Some events could not be stored.</div>':''}<div class="device-footer spaced">${can('caregiver')?`<button class="btn primary" data-action="checkin" data-id="${device.id}">Send check-in ↗</button>`:''}${can('owner')?`<button class="btn" data-action="pair" data-id="${device.id}">${device.last_seen?'Add gateway':'Connect pendant'}</button><button class="btn ghost" data-action="settings" data-id="${device.id}">Settings</button>`:''}</div></article>`;
}
function reminderRows(reminders) {
  return reminders.length ? `<div class="list">${reminders.map(r=>`<div class="list-item"><div class="event-icon">◷</div><div class="list-body"><strong>${esc(r.label)}</strong><p>${esc(parentName(r.device_id))} · Every day, ${String(Math.floor(r.minute/60)).padStart(2,'0')}:${String(r.minute%60).padStart(2,'0')} IST</p></div>${can('caregiver')?`<button class="btn small" data-action="toggle-reminder" data-id="${r.id}">${r.enabled?'Pause':'Resume'}</button>`:''}</div>`).join('')}</div>` : empty('Small reminders, less worry','Add a schedule. The pendant stores it for offline use.');
}
function inboxTable() {
  return table(['Event','Recipient','Channel','Outcome','Attempts','Created'], data.notifications.map(n => [esc(eventLabel(data.events.find(e=>e.id===n.event_id)||{kind:'Earlier event'})), esc(n.channel==='push'?'Caregiver phones':n.recipient), esc(n.channel.replace('_',' ')), pill(n.status,['failed','retry'].includes(n.status)?'red':'gray')+(n.error?`<small>${esc(n.error)}</small>`:''), n.attempts, esc(stamp(n.created_at))]), empty('No notifications yet','Alerts will be recorded here, including failed delivery attempts.'));
}
function circlePage() {
  const members = extra?.members || data.members;
  const rows = members.map(m => [`${esc(m.name)}<small>${esc(m.email)}</small>`, pill(m.household_role, m.household_role==='owner'?'':'gray')+`<small>${ROLE_HELP[m.household_role]}</small>`, esc(stamp(m.created_at)), can('owner') && m.id !== data.me.id ? `<button class="btn small" data-action="member" data-id="${m.id}">Manage</button>` : m.id === data.me.id ? '<small>You</small>' : '']);
  const invites = (extra?.invites || []).map(i => [pill(i.role,'gray'), esc(stamp(i.created_at)), esc(stamp(i.expires_at))]);
  return title('Your Care Circle','Everyone who helps look after your parents, each with the right level of access.', can('owner')?'<button class="btn primary" data-action="invite">+ Invite someone</button>':'')+`<div class="notice"><strong>Owner</strong>: parents, gateways, members and settings. <strong>Caregiver</strong>: reminders, contacts and check-ins. <strong>Viewer</strong>: sees updates and can acknowledge an alert. Members get app alerts on their own phones.</div><div class="card spaced">${table(['Member','Role','Joined',''], rows, empty('Just you so far','Invite a sibling, spouse or trusted neighbour.'))}</div>${can('owner')?`<div class="section-title"><h2>Open invites</h2><p>Codes are shown once when created and expire after seven days.</p></div><div class="card">${table(['Role','Created','Expires'], invites, empty('No open invites','Create one and share the code privately.'))}</div>`:''}`;
}
function familyPage() {
  if (!data.me.household_id) return title('You are not in a family right now.','An owner removed you, or your family was closed.')+`<div class="notice warning">Ask a family owner for a new invite code, then create a new account with it, or sign out and create your own family.</div>`;
  if (view==='circle') return circlePage();
  if (view==='alerts') {
    const critical=data.events.filter(event=>eventSeverity(event)==='critical');
    const warnings=data.events.filter(event=>eventSeverity(event)==='warning');
    return title('Alerts','Critical events need an immediate check. Warnings should be handled soon.')+`${critical.length?`<div class="section-title"><h2>Critical</h2><p>Possible falls and SOS events.</p></div><div class="card">${eventList(critical,150)}</div>`:''}${warnings.length?`<div class="section-title"><h2>Warnings</h2><p>Connection, battery, sensor and missed-response issues.</p></div><div class="card">${eventList(warnings,150)}</div>`:''}${!critical.length&&!warnings.length?'<div class="notice">No active alerts. Routine updates remain in Activity.</div>':''}<p class="bottom-note">Acknowledgement stops future escalation. It does not confirm that the person is safe.</p>`;
  }
  if (view==='activity') return title('The care timeline','An honest record of what happened, and what was acknowledged.')+`<div class="card">${eventList(data.events,150)}</div><div class="section-title"><h2>Notification inbox</h2><p>Available means stored in this household inbox. It does not mean a person has read it.</p></div><div class="card">${inboxTable()}</div>`;
  if (view==='reminders') return title('A rhythm that feels familiar.','Daily schedules run in India Standard Time.', can('caregiver')?'<button class="btn primary" data-action="reminder">+ Add reminder</button>':'')+`<div class="notice">A button press records <strong>reminder acknowledged</strong>—not verified medication consumption. Up to eight schedules per pendant. Keep a gateway connected when changing schedules.</div><div class="card spaced">${reminderRows(data.reminders)}</div>`;
  if (view==='contacts') return title('Who gets alerted, in order.','Contacts are notified one after another until someone acknowledges.', can('caregiver')?'<button class="btn primary" data-action="contact">+ Add contact</button>':'')+`<div class="notice ${data.smtp_enabled?'':'warning'}">${data.smtp_enabled?'Email delivery is enabled. “Sent” means accepted by the provider, not read.':'External email is disabled; alerts stay in the app inbox.'} Phone numbers are used for SMS/voice escalation of falls and SOS when your operator enables it. Care Circle members also get push alerts on their phones.</div><div class="grid spaced">${data.devices.map(device=>`<div class="card"><h3>${esc(device.name)}’s contacts</h3><p><small>Next contact after ${device.escalation_seconds} seconds without acknowledgement.</small></p><div class="list">${data.contacts.filter(c=>c.device_id===device.id).map((contact,i)=>`<div class="list-item"><div class="event-icon">${i+1}</div><div class="list-body"><strong>${esc(contact.name)}</strong><p>${esc(contact.email)}${contact.phone?' · '+esc(contact.phone):''}</p></div>${can('caregiver')?`<button class="btn ghost" data-action="remove-contact" data-id="${contact.id}">Remove</button>`:''}</div>`).join('') || empty('The family owner is the first contact','No additional contacts configured.')}</div></div>`).join('')}</div>`;
  const urgent = data.events.filter(event=>eventSeverity(event)==='critical');
  const warnings = data.events.filter(event=>eventSeverity(event)==='warning');
  return title(`Good morning, ${esc(account.name.split(' ')[0])}.`, 'Connection, last report and anything needing action.', can('owner')?'<button class="btn primary" data-action="device">+ Add parent</button>':'')+`${urgent.length?`<div class="notice error"><strong>${urgent.length} critical alert${urgent.length===1?'':'s'} ${urgent.length===1?'needs':'need'} attention.</strong> Check on your family member now. <a href="/family?view=alerts">View alerts →</a></div><br>`:warnings.length?`<div class="notice warning"><strong>${warnings.length} item${warnings.length===1?'':'s'} should be checked soon.</strong> <a href="/family?view=alerts">Review warnings →</a></div><br>`:'<div class="notice"><strong>No active critical alerts.</strong> This reflects the last information LOOMCARE received, not proof of wellbeing.</div><br>'}<section class="hero"><div><div class="eyebrow">Independent, not alone</div><h2>Care that connects.<br>Without getting in the way.</h2><p>A simple locket for your parents. Meaningful updates for you. Start with a check-in, or explore a complete simulated care journey.</p>${data.devices.length?(can('caregiver')?'<button class="btn" data-action="quick-checkin">Send a little reassurance ↗</button>':''):(can('owner')?'<button class="btn" data-action="device">Add your first parent ↗</button>':'')}</div>${art}</section><div class="row section-title"><div><h2>Your people</h2><p>Device connectivity is not confirmation of wellbeing.</p></div>${pill(`${data.devices.filter(d=>d.online).length} / ${data.devices.length} connected`,'gray')}</div><div class="grid">${data.devices.map(deviceCard).join('') || `<div class="card">${empty('Let’s connect your first parent','Choose a virtual locket to test everything without electronics.')}${can('owner')?'<button class="btn primary" data-action="device">+ Add parent</button>':''}</div>`}</div><div class="two-col spaced"><section class="card"><div class="row"><h3>Recent moments</h3><a href="/family?view=activity"><small>View activity →</small></a></div>${eventList(data.events)}</section><section class="card"><div class="row"><h3>A gentle daily rhythm</h3>${can('caregiver')?'<button class="btn small" data-action="reminder">+ Reminder</button>':''}</div>${reminderRows(data.reminders.slice(0,4))}</section></div><div class="notice spaced ${data.push_enabled||data.smtp_enabled?'':'warning'}">${data.push_enabled?'Phone push alerts are enabled for Care Circle members who installed the LOOMCARE app.':'Demo delivery: alerts appear here while this page is open. Push alerts reach members through the LOOMCARE phone app once your operator enables them.'} <button class="btn small" data-action="browser-notifications">Enable browser alerts</button></div><p class="bottom-note">No continuous location tracking. No diagnosis. No automatic ambulance dispatch. Prototype for supervised testing.</p>`;
}
function fleetRows(devices, gateways) {
  return devices.map(d => {
    const gws = gateways.filter(g => g.device_id === d.id);
    return [`<strong>${esc(d.name)}</strong><small>${esc(d.firmware)} · ${d.mode}</small>`, pill(linkState(d), d.online ? '' : d.silent_seconds != null && d.silent_seconds >= d.offline_alert_seconds ? 'red' : 'amber'), d.battery == null ? '—' : Math.round(d.battery) + '%',
      gws.map(g => `<div class="row"><span>${esc(KIND[g.kind])}: ${g.online ? (g.connected ? 'relaying' : 'pendant not heard') : 'offline'} <small>${esc(g.app_version || '')} · ${esc(ago(g.last_seen))}</small></span>${admin() ? `<button class="btn ghost small" data-action="revoke-gateway" data-id="${g.id}">Revoke</button>` : ''}</div>`).join('') || '<small>No gateways</small>'];
  });
}
function teamPage() {
  const incidents = data.events.filter(e=>['open','escalated','missed'].includes(e.status));
  if (view==='incidents') return title('The incident desk','Triage and acknowledge. Acknowledgement records your action, not a medical outcome.')+`<div class="card">${eventList(incidents,150)}</div>`;
  if (view==='delivery') return title('Notification delivery','Durable attempts, bounded retries, and explicit outcomes.')+`<div class="notice">Active channels: <strong>${esc((metrics?.channels||['in_app']).join(', ').replace('_',' '))}</strong>. In-app “available” is not human receipt; “sent” is provider acceptance, not read confirmation. SMS/voice run through the signed escalation webhook to your telephony provider.</div><div class="card spaced">${inboxTable()}</div>`;
  if (view==='customers') {
    const rows = (extra?.households || []).map(h => [`<code>${esc(h.id.slice(0,8).toUpperCase())}</code>`, `<strong>${esc(h.owner || '—')}</strong><small>${esc(h.owner_email || '')}</small>`, esc(h.name), h.devices===0?pill('Unknown','gray'):h.online===h.devices?pill('Connected'):h.online?pill('Partly connected','amber'):pill('Disconnected','red'), h.open_incidents ? pill(String(h.open_incidents), 'red') : '0', esc(stamp(h.last_sync)), `<a class="btn small" href="/team?view=household&id=${encodeURIComponent(h.id)}">Open</a>`]);
    return title('Consumer directory','Registered households with honest connection and attention states. Age and subscription remain unconfigured until those data models are approved.')+`<div class="card">${table(['Consumer ID','Consumer','Household','Connection','Open alerts','Last sync',''], rows, empty('No customers yet','Use the family app to create a test household.'))}</div>`;
  }
  if (view==='household') {
    if (!extra?.household) return empty('Household not found','Return to Customers.');
    const d = extra;
    return title(esc(d.household.name), `Customer since ${esc(stamp(d.household.created_at))}`, `<button class="btn primary" data-action="note" data-id="${d.household.id}">+ Support note</button>`)+`<div class="two-col"><div class="card"><h3>Care Circle</h3>${table(['Member','Role'], d.members.map(m => [`${esc(m.name)}<small>${esc(m.email)}</small>`, pill(m.household_role,'gray')]), empty('No members',''))}</div><div class="card"><h3>Support notes</h3><div class="list">${d.notes.map(n => `<div class="list-item"><div class="list-body"><strong>${esc(n.author)}</strong><p>${esc(n.body)}</p></div><span class="list-time">${esc(stamp(n.created_at))}</span></div>`).join('') || empty('No notes yet','Record calls, visits and follow-ups here.')}</div></div></div><div class="section-title"><h2>Pendants & gateways</h2></div><div class="card">${table(['Pendant','Status','Battery','Gateways'], fleetRows(d.devices, d.gateways), empty('No pendants',''))}<p><small>Assigned units: ${d.inventory.map(i => esc(i.serial)).join(', ') || 'none'}</small></p></div><div class="section-title"><h2>Recent events</h2></div><div class="card">${eventList(d.events, 50)}</div>`;
  }
  if (view==='fleet') return title('Fleet & gateways','Every pendant and the gateways relaying it. Silence is shown immediately here; families are alerted only after their chosen window.')+`<div class="card">${table(['Pendant','Status','Battery','Gateways'], fleetRows(data.devices, data.gateways), empty('No pendants yet',''))}</div>`;
  if (view==='inventory') {
    const rows = (extra?.inventory || []).map(i => [`<strong>${esc(i.serial)}</strong><small>${esc(i.hardware_rev)}</small>`, pill(i.status.replace('_',' '), i.status==='faulty'?'red':i.status==='assigned'?'':'gray'), i.device_name ? `${esc(i.device_name)}<small>${esc(i.household || '')}</small>` : '—', esc(i.notes || ''), esc(stamp(i.updated_at)), admin() ? `<button class="btn small" data-action="edit-unit" data-id="${esc(i.serial)}">Edit</button>` : '']);
    return title('Device inventory','Track every pendant from stock to a family and back.', admin()?'<button class="btn primary" data-action="add-unit">+ Add unit</button>':'')+`<div class="card">${table(['Unit','Status','Assigned to','Notes','Updated',''], rows, empty('No units recorded','Administrators add serial numbers as pendants are built.'))}</div>`;
  }
  if (view==='team') return title('Your team','Administrators manage inventory, gateways and staff. Support staff triage incidents and write notes.')+`<div class="notice">Add staff from the server: <code>flask --app app create-operator --email name@company.com --team-role support</code></div><div class="card spaced">${table(['Name','Role','Since'], (extra?.team || []).map(t => [`${esc(t.name)}<small>${esc(t.email)}</small>`, pill(t.team_role, t.team_role==='admin'?'':'gray'), esc(stamp(t.created_at))]), empty('No team members',''))}</div>`;
  if (view==='audit') return title('An accountable care system','Administrative changes and incident actions, recorded by actor.')+`<div class="card">${table(['Action','Actor','Target','Time'], (metrics?.audit||[]).map(a => [esc(a.action.replaceAll('_',' ')), `<code>${esc(a.actor.slice(0,12))}</code>`, `<code>${esc(a.target.slice(0,12))}</code>`, esc(stamp(a.at))]), empty('No actions yet',''))}</div>`;
  const silent = data.devices.filter(d => !d.online && d.last_seen);
  const stats = [['Customer households',data.customers.length,'Self-service family accounts'],['Pendants online',`${data.devices.filter(d=>d.online).length} / ${data.devices.length}`,`${silent.length} silent right now`],['Needs attention',incidents.length,'Incidents and missed responses'],['API p95',metrics?.p95_ms==null?'—':`${metrics.p95_ms} ms`,'Server processing · rolling sample']];
  return title('Care operations, at a glance.','A live view of the prototype. Separate system health from human wellbeing.')+`<div class="metric-grid">${stats.map(([label,value,detail])=>`<div class="card metric"><span>${label}</span><strong>${value}</strong><small>${detail}</small></div>`).join('')}</div><div class="notice">Observed API timing is not end-to-end alert latency. UI refresh: 2 seconds. Workflow tick: 1 second. Local fall cancellation: 15 seconds. Worker last tick: ${esc(stamp(metrics?.worker_last_tick))}.</div><div class="two-col spaced"><div class="card"><div class="row"><h3>Attention queue</h3><a href="/team?view=incidents"><small>Open desk →</small></a></div>${eventList(incidents,8)}</div><div class="card"><div class="row"><h3>Silent pendants</h3><a href="/team?view=fleet"><small>Fleet →</small></a></div><div class="list">${silent.map(d=>`<div class="list-item"><div class="avatar">${esc(d.name[0])}</div><div class="list-body"><strong>${esc(d.name)}</strong><p>${esc(linkState(d))} · family alert after ${esc(span(d.offline_alert_seconds))}</p><p>${data.gateways.filter(g=>g.device_id===d.id).map(g=>esc(KIND[g.kind])+(g.online?' online':' offline')).join(' · ') || 'No gateways'}</p></div>${pill(d.silent_seconds >= d.offline_alert_seconds ? 'Family alerted' : 'Watching', d.silent_seconds >= d.offline_alert_seconds ? 'red' : 'amber')}</div>`).join('')||empty('Every pendant is being heard','Silence appears here immediately.')}</div></div></div><div class="section-title"><h2>Recent notification attempts</h2></div><div class="card">${inboxTable()}</div><p class="bottom-note">Operator access includes household data for supervised prototype support. Minimise access and use test identities.</p>`;
}
function chooseDevice() {
  if (!data.devices.length) throw new Error('Add a parent first.');
  return `<label>Parent<select name="device_id">${data.devices.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></label>`;
}
const minutes = [5,10,15,30,60,120,240,720];
async function action(button) {
  const id = button.dataset.id;
  switch (button.dataset.action) {
    case 'logout':
      if (account) await api('/api/logout', {});
      location.href = team?'/team':'/family'; return;
    case 'device':
      modal('Connect someone you care for', `<form class="form"><label>Parent’s name<input name="name" required maxlength="80" placeholder="Mum, Dad, or their name"></label><label>Device<select name="mode"><option value="simulator">Virtual pendant · no hardware needed</option><option value="physical">XIAO nRF54L15 pendant · Bluetooth</option></select></label><p><small>Use test identities while evaluating this prototype.</small></p>${formFooter('Add parent')}</form>`, async (values, dialog)=>{await api('/api/devices',values);dialog.close();toast('Parent added. Connect a gateway to start testing.');await refresh();}); return;
    case 'pair':
      modal('Add a gateway', `<p>Gateways carry pendant alerts to LOOMCARE. Add the parent’s phone and, ideally, a Home Hub: either one can relay. Up to four per pendant.</p><form class="form spaced"><label>Gateway type<select name="kind"><option value="web">This browser · test gateway and simulator</option><option value="phone">Parent’s phone · LOOMCARE app</option><option value="hub">Home Hub</option></select></label><div class="notice warning">The pairing link works like a password. Share it only with the device being set up.</div>${formFooter('Create gateway link')}</form>`, async (values, dialog)=>{
        const result=await api(`/api/devices/${id}/gateways`,{kind:values.kind});
        const deep=`loomcare://gateway-pair?server=${encodeURIComponent(location.origin)}&token=${encodeURIComponent(result.token)}`;
        const virtual=data.devices.find(device=>device.id===id)?.mode==='simulator';
        dialog.innerHTML = values.kind==='web' ? `<h2 id="dialog-title">Your gateway is ready</h2><p>Open on the parent’s Android Chrome browser, or use this computer for the simulator. Keep the gateway open.</p><a class="btn primary spaced" href="/gateway#${encodeURIComponent(result.token)}" target="_blank" rel="noopener noreferrer">Open parent gateway ↗</a>${virtual?`<a class="btn spaced" href="/simulator#${encodeURIComponent(result.token)}" target="_blank" rel="noopener noreferrer">Open Locket Lab ↗</a>`:''}<p class="spaced"><small>The token is removed from the address bar on opening and stored only in that tab.</small></p><button class="btn spaced" data-close>Done</button>`
          : `<h2 id="dialog-title">Pair ${esc(result.name)}</h2><p>Easiest: in the LOOMCARE family app, open this parent and tap <strong>Set up parent’s phone</strong> to show a QR code. Or open this link on the device being set up:</p><pre>${esc(deep)}</pre><button class="btn" data-copy>Copy pairing link</button><button class="btn spaced" data-close>Done</button>`;
        dialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{dialog.close();refresh();});
        const copy=$('[data-copy]',dialog); if (copy) copy.onclick=async()=>{await navigator.clipboard.writeText(deep);toast('Pairing link copied. Paste it only on the parent’s device.');};
      });return;
    case 'quick-checkin':
    case 'checkin':
      await api(`/api/devices/${id || data.devices[0].id}/checkin`,{});toast('Check-in queued. Waiting up to two minutes for a button response.');await refresh();return;
    case 'reminder':
      modal('A gentle daily reminder', `<form class="form">${chooseDevice()}<label>Reminder label<input name="label" required maxlength="80" placeholder="Evening medication reminder"></label><label>Time · India Standard Time<input type="time" name="time" required></label><p><small>Configure only an existing prescribed schedule. Acknowledgement does not verify consumption.</small></p>${formFooter('Save reminder')}</form>`,async(values,dialog)=>{const device=values.device_id;delete values.device_id;await api(`/api/devices/${device}/reminders`,values);dialog.close();toast('Saved. The gateway will sync this schedule to the pendant.');await refresh();});return;
    case 'toggle-reminder':
      await api(`/api/reminders/${id}`,{enabled:!data.reminders.find(r=>r.id===id).enabled},'PATCH');await refresh();return;
    case 'contact':
      modal('Add a care contact', `<form class="form">${chooseDevice()}<label>Name<input name="name" required maxlength="80"></label><label>Email<input name="email" type="email" required></label><label>Mobile number (optional)<input name="phone" type="tel" placeholder="+919876543210" pattern="\\+[1-9][0-9]{7,14}"></label><p><small>Use only a contact who has consented to emergency notifications. New contacts go to the end of the escalation chain.</small></p>${formFooter('Add contact')}</form>`,async(values,dialog)=>{const device=values.device_id;delete values.device_id;if(!values.phone)delete values.phone;await api(`/api/devices/${device}/contacts`,values);dialog.close();toast('Contact added.');await refresh();});return;
    case 'remove-contact':
      modal('Remove this contact?',`<form class="form"><p>This destination will no longer receive future escalations.</p>${formFooter('Confirm removal')}</form>`,async(_,dialog)=>{await api(`/api/contacts/${id}`,{},'DELETE');dialog.close();await refresh();});return;
    case 'settings': {
      const device=data.devices.find(d=>d.id===id), gws=data.gateways.filter(g=>g.device_id===id);
      const current=Math.round(device.offline_alert_seconds/60);
      modal('Parent & alert settings',`<form class="form"><label>Parent’s name<input name="name" value="${esc(device.name)}" required maxlength="80"></label><label>Seconds before alerting the next contact<input name="escalation_seconds" type="number" min="15" max="600" value="${device.escalation_seconds}" required></label><label>Alert the family if the pendant is silent for<select name="offline_alert_minutes">${[...new Set([...minutes,current])].sort((a,b)=>a-b).map(m=>`<option value="${m}" ${m===current?'selected':''}>${m<60?m+' minutes':(m/60)+' hour'+(m===60?'':'s')}</option>`).join('')}</select></label><p><small>Your care team sees silence immediately. A short window means more “out of reach” alerts when the parent leaves the phone or hub behind.</small></p>${formFooter()}</form><div class="section-title"><h3>Gateways</h3></div><div class="list">${gws.map(g=>`<div class="list-item"><div class="list-body"><strong>${esc(g.name)}</strong><p>${esc(KIND[g.kind])} · ${g.online?'online':'last seen '+esc(ago(g.last_seen))}</p></div><button class="btn ghost small" data-action="revoke-gateway" data-id="${g.id}">Remove</button></div>`).join('')||empty('No gateways','Use Add gateway on the parent card.')}</div>`,async(values,dialog)=>{await api(`/api/devices/${id}`,{name:values.name,escalation_seconds:Number(values.escalation_seconds),offline_alert_seconds:Number(values.offline_alert_minutes)*60},'PATCH');dialog.close();await refresh();});return;
    }
    case 'revoke-gateway':
      modal('Remove this gateway?',`<form class="form"><p>It stops relaying immediately and must be paired again to return. Other gateways keep working.</p>${formFooter('Remove gateway')}</form>`,async(_,dialog)=>{await api(`/api/gateways/${id}`,{},'DELETE');dialog.close();toast('Gateway removed.');await refresh();});return;
    case 'ack':
      modal('Acknowledge this incident',`<form class="form"><p>This stops further contact-chain escalation. Please check on the person; the system cannot verify their safety.</p><label>Action taken<textarea name="note" maxlength="300" required placeholder="Called Mum and arranged for a neighbour to check"></textarea></label>${formFooter('Record acknowledgement')}</form>`,async(values,dialog)=>{await api(`/api/events/${id}/ack`,values);dialog.close();toast('Acknowledgement recorded.');await refresh();});return;
    case 'invite':
      modal('Invite to your Care Circle',`<form class="form"><label>Role<select name="role"><option value="caregiver">Caregiver · reminders, contacts, check-ins</option><option value="viewer">Viewer · updates and alert acknowledgement</option></select></label>${formFooter('Create invite code')}</form>`,async(values,dialog)=>{const result=await api('/api/invites',values);dialog.innerHTML=`<h2 id="dialog-title">Share this code privately</h2><p class="countdown invite-code">${esc(result.code)}</p><p>They choose <strong>Create family account</strong> in the app or at /family and enter this code. It works once and expires ${esc(stamp(result.expires_at))}. It will not be shown again.</p><button class="btn primary spaced" data-close>Done</button>`;dialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{dialog.close();refresh();});});return;
    case 'member': {
      const m=(extra?.members||data.members).find(x=>x.id===id);
      modal(`Manage ${m.name}`,`<form class="form"><label>Role<select name="role">${['owner','caregiver','viewer'].map(r=>`<option value="${r}" ${r===m.household_role?'selected':''}>${r} · ${ROLE_HELP[r]}</option>`).join('')}</select></label>${formFooter('Save role')}</form><button class="btn danger spaced" data-remove>Remove from Care Circle</button>`,async(values,dialog)=>{await api(`/api/members/${id}`,values,'PATCH');dialog.close();toast('Role updated.');await refresh();});
      $('[data-remove]').onclick=async()=>{try{await api(`/api/members/${id}`,{},'DELETE');$('#modal').close();toast('Member removed and signed out of their phones.');await refresh();}catch(e){toast(e.message);}};return;
    }
    case 'note':
      modal('Add a support note',`<form class="form"><label>Note<textarea name="body" maxlength="1000" required placeholder="Called the family; pendant was charging. Follow up tomorrow."></textarea></label><p><small>Visible to your team only. Avoid medical detail that isn’t needed for support.</small></p>${formFooter('Save note')}</form>`,async(values,dialog)=>{await api(`/api/operator/households/${id}/notes`,values);dialog.close();await refresh();});return;
    case 'add-unit':
      modal('Add a pendant unit',`<form class="form"><label>Serial<input name="serial" required maxlength="32" placeholder="LC-EVT0-0001"></label><label>Hardware revision<input name="hardware_rev" required maxlength="40" value="XIAO-nRF54L15+BMI270"></label>${formFooter('Add unit')}</form>`,async(values,dialog)=>{await api('/api/operator/inventory',values);dialog.close();await refresh();});return;
    case 'edit-unit': {
      const unit=(extra?.inventory||[]).find(u=>u.serial===id);
      modal(`Unit ${unit.serial}`,`<form class="form"><label>Status<select name="status">${['in_stock','assigned','returned','faulty','retired'].map(s=>`<option value="${s}" ${s===unit.status?'selected':''}>${s.replace('_',' ')}</option>`).join('')}</select></label><label>Assigned pendant (for “assigned”)<select name="device_id"><option value="">None</option>${data.devices.map(d=>`<option value="${d.id}" ${d.id===unit.device_id?'selected':''}>${esc(d.name)} · ${d.id.slice(0,6).toUpperCase()}</option>`).join('')}</select></label><label>Notes<input name="notes" maxlength="500" value="${esc(unit.notes)}"></label>${formFooter()}</form>`,async(values,dialog)=>{await api(`/api/operator/inventory/${encodeURIComponent(id)}`,{status:values.status,device_id:values.device_id||null,notes:values.notes},'PATCH');dialog.close();await refresh();});return;
    }
    case 'browser-notifications':
      if (!('Notification' in window)) throw new Error('Browser notifications are not supported here.');
      toast((await Notification.requestPermission())==='granted'?'Enabled while this app remains open.':'Browser notification permission was not granted.');return;
  }
}
function extraRequest() {
  if (!team) return view==='circle' ? api('/api/members') : null;
  if (view==='customers') return api('/api/operator/households');
  if (view==='household' && params.get('id')) return api(`/api/operator/households/${encodeURIComponent(params.get('id'))}`);
  if (view==='inventory') return api('/api/operator/inventory');
  if (view==='team' && admin()) return api('/api/operator/team');
  return null;
}
let refreshing=false;
async function refresh() {
  if (refreshing || ['/hardware','/plan'].includes(page)) return;
  refreshing=true;
  try {
    const results=await Promise.all([api('/api/state'),team?api('/api/operator/metrics'):Promise.resolve(null),extraRequest()]);
    [data,metrics,extra]=results;
    if (!team && 'Notification' in window && Notification.permission==='granted') {
      for (const n of data.notifications) if (loadedNotifications && !notified.has(n.id) && n.channel==='in_app') new Notification('LOOMCARE: a care update needs your attention',{body:'Open your family timeline for details.',tag:n.id});
    }
    notified=new Set(data.notifications.map(n=>n.id));loadedNotifications=true;
    const signature=JSON.stringify({...data,now:0})+JSON.stringify(extra)+(team?JSON.stringify(metrics):'');
    if (signature!==currentSignature) {$('#content').innerHTML=team?teamPage():familyPage();currentSignature=signature;}
    $('#connection').innerHTML='<i class="dot"></i> Prototype · connected';
  } catch(e) {
    $('#connection').innerHTML='<i class="dot bad"></i> Offline · data may be stale';
    if (!data) $('#content').innerHTML=`<div class="notice error">${esc(e.message)} <a href="${team?'/team':'/family'}">Reload / sign in</a></div>`;
  } finally {refreshing=false;}
}
async function start() {
  if (page==='/gateway') { const {startGateway}=await import('./gateway.js'); await startGateway(); return; }
  if (page==='/simulator') { const {startSimulator}=await import('./simulator.js'); await startSimulator(); return; }
  const session=await api('/api/session');csrf=session.csrf;account=session.user;
  if (page==='/hardware') {
    developerShell();$('#content').innerHTML=(await import('./hardware.js')).hardwarePage();
  } else if (page==='/plan') {
    shell();$('#content').innerHTML=(await import('./resources.js')).planPage();$('#connection').textContent='V1 prototype · build resources';
  } else if (!account) {auth();return;}
  else if (team && account.role!=='operator') {shell();$('#content').innerHTML='<div class="notice warning">This is a family account. Sign out and use an administrator-provisioned team account to enter this workspace.</div>';}
  else {if (!team && account.role==='operator') {location.href='/team';return;}shell();await refresh();setInterval(()=>{if(!document.hidden)refresh();},2000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});}
  document.addEventListener('click', async event=>{const button=event.target.closest('[data-action]');if(!button)return;button.disabled=true;try{await action(button);}catch(e){toast(e.message);}finally{button.disabled=false;}});
}
start().catch(e=>{$('#app').innerHTML=`<div class="loading"><div><h2>We couldn’t open your care space.</h2><p>${esc(e.message)}</p><a href="/">Try again</a></div></div>`;});
