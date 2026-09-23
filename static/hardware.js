import {rigPage} from './resources.js';

const link = (url, label) => url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${label} ↗</a>` : label;
const table = (head, rows) => `<div class="card table-wrap"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

const bom = [
  ['Wireless MCU', '<strong>Nordic nRF54L15</strong> as a pre-certified module, e.g. Raytac AN54LV-15 (chip antenna, 6.4 × 8.4 × 1.5 mm) + external 32.768 kHz crystal', 'Bluetooth 6.0 LE incl. Coded PHY (−104 dBm) • 3.0 µA idle with RTC • 5.0 mA TX @ 0 dBm • module lists WPC among its certifications', 'nRF52833 / nRF52840 modules (mature fallback)', link('https://www.raytac.com/product/ins.php?index_id=176', 'Raytac AN54LV')],
  ['Motion sensor', '<strong>Bosch BMI270</strong> (finalized), ±16 g, 50 Hz accel in low-power mode', 'Same part in prototype and product, so collected motion data carries over • accel-first detection; gyro (~0.4 mA) switches on only for ~6 s after a candidate impact • any-motion interrupt wake is the next power step', 'ST LSM6DSV16X (on-sensor logic, costs more)', link('https://www.bosch-sensortec.com/products/motion-sensors/imus/bmi270/', 'Bosch')],
  ['Barometer (recommended add)', '<strong>ST ILPS28QSW</strong>, gel-filled, water-resistant, O-ring sealable', 'Height-drop confirmation cuts false alarms • 1.7 µA • keep optional until pilot data proves value', 'Leave unpopulated on the PCB', link('https://www.st.com/en/mems-and-sensors/ilps28qsw.html', 'ST')],
  ['Power management', '<strong>Nordic nPM1300</strong>', '32–800 mA charger • 2 × 200 mA buck • fuel gauge • 370 nA ship mode • watchdog, hard reset, power-loss warning', 'TI BQ25155', link('https://www.nordicsemi.com/Products/nPM1300', 'Nordic')],
  ['Battery', 'Certified 1S Li-ion/LiPo, <strong>145–300 mAh</strong>, protection circuit + 10k NTC', 'BIS-registered cell • prismatic cells are typically 4–5 mm thick; smaller capacities fit the 9–11 mm target more easily', 'Size set after EVT power measurements', 'Indian cell makers / importers with BIS registration'],
  ['Haptic', '8–10 mm coin <strong>LRA + TI DRV2605L</strong>', 'Strong, consistent buzz for reduced sensitivity • runs from 2–5.2 V • 1.8 V-compatible I²C • auto-resonance', 'Coin ERM on the same driver; piezo haptics only for a proven need', link('https://www.ti.com/product/DRV2605L', 'TI')],
  ['Sound', 'Thin piezo transducer + <strong>Diodes PAM8904</strong> charge-pump driver', '18 Vpp from a 3 V supply for loudness • acoustic port behind a waterproof membrane • verify loudness through the real enclosure', 'Magnetic buzzer (louder at low frequency, bigger)', link('https://www.diodes.com/datasheet/download/PAM8904.pdf', 'Diodes')],
  ['Input', 'One large sealed button: IP67 tactile switch under a TPE cap', 'Tap = acknowledge/cancel, 2 s hold = SOS • also wired to nPM1300 SHPHLD to wake from ship mode (hard-reset hold set much longer)', '—', 'Sealed tactile switch series from major switch makers'],
  ['Visual', 'One low-current RGB LED + light pipe', 'Short PWM pulses from the nRF (target ≤ 1–2 µA average); nPM1300 5 mA LED drivers only for charge state', '—', '—'],
  ['Storage', 'Internal 1.5 MB NVM + optional SPI NOR (e.g. Macronix MX25R6435F, 64 Mbit)', 'Flash fitted on pilot units for raw-motion logging, which validation depends on; AN54LV QSPI is emulated, so use SPI', 'Omit on production units if not needed', '—'],
  ['Charging', 'Mechanical cradle, spring pogo pins, gold-plated flat pads on pendant, magnetic alignment', 'No open port, so sealing is easier • ESD/TVS + reverse-polarity protection • cradle powered by a BIS-certified USB adapter', 'Qi (larger, warmer, costlier)', 'Custom cradle + pogo-pin connectors'],
  ['Enclosure & wear', 'PC or PC/ABS, ultrasonic-welded, TPE overmould; short breakaway lanyard', 'IP67 minimum / IP68 target by ingress test • skin-contact material check • clip only after separate validation', '—', 'Local tooling / 3D print for EVT'],
  ['Test & programming', 'SWD test pads + production test points', 'Flash, calibrate and test every unit without opening the seal', '—', '—']
];

const devKits = [
  ['Seeed XIAO nRF54L15 (plain)', 'Main chip, Bluetooth, USB-C, onboard Li-ion charger and switched battery sensing (AIN7)', '₹985–1,029', 'Robu / Seeed distributors'],
  ['BMI270 breakout (e.g. 7Semi)', 'The finalized motion sensor on the XIAO I²C bus (D4/D5), address 0x68', '≈ ₹512', 'Indian maker stores'],
  ['200 mAh LiPo with protection circuit', 'Plugs into the XIAO battery pads; charge current stays within the cell rating', '₹79–150', 'Indian battery suppliers'],
  ['Coin vibration motor + transistor + flyback diode', 'Driven from D1; strong buzz for reminders and alerts', '₹120–300', 'Robu / local'],
  ['12 mm piezo, large tactile button, RGB LED', 'Piezo on D2 (PWM), button on D0, LED on D3/D8/D9', '₹65–100', 'Local'],
  ['Solder board, wires, 3D-printed case, pogo-pin cradle, magnets, neck cord', 'A wearable, droppable test unit (not a breadboard)', '₹380–630', 'Local / 3D print'],
  ['<strong>Total per prototype</strong>', '', '<strong>≈ ₹2,150–2,700 (limit ₹3,000)</strong>', ''],
  ['One-time tool: Nordic Power Profiler Kit II', 'Measures real battery use; battery-life claims come from this', 'Not per unit', 'Mouser / DigiKey / element14 India'],
];

const production = [
  ['nRF54L15 bare chip + crystals + antenna', '₹250–280'], ['BMI270', '₹130–230 (get quote)'], ['nPM1300 power chip', '₹115–120'], ['DRV2605L + coin LRA', '₹110–190'],
  ['PAM8904 + piezo', '₹45–70'], ['150–200 mAh BIS-certified cell', '₹90–160'], ['Button, LED, passives', '₹50–80'], ['PCB + assembly + test', '₹130–220'],
  ['Moulded case, button cap, light pipe, cord', '₹100–200'], ['Charging cradle + cable', '₹110–180'], ['Packaging', '₹40–70'], ['Freight, customs, rejects (~8%)', '₹100–140'],
  ['<strong>Total at 1,000–2,000 units</strong>', '<strong>≈ ₹1,300–1,950 (limit ₹2,000)</strong>'],
];

// [item, assumption, low µA, high µA, source]
const power = [
  ['BMI270 accelerometer, always on', '50 Hz in low-power mode (driver enables advanced power save)', 10, 40, 'Estimate from Bosch low-power table; measure'],
  ['BMI270 gyro bursts', '~0.4 mA for ~6 s after each candidate impact, 20–100 candidates/day', 0.6, 2.8, 'Calculated from datasheet'],
  ['nRF54L15 idle', 'System ON idle with RTC, RAM retained', 2, 3, 'Nordic datasheet'],
  ['BLE connection', '1 s interval with peripheral latency, 0 dBm', 8, 25, 'Estimate; confirm in Nordic Online Power Profiler'],
  ['BLE advertising while out of range', '~20% of the day at slow 1–2 s intervals; fast bursts only after urgent events', 2, 6, 'Estimate'],
  ['Barometer (optional)', 'On demand (low) to 1 Hz continuous (high)', 0.2, 1.7, 'ST datasheet'],
  ['PMIC + regulator overhead', 'nPM1300 quiescent incl. buck', 1, 5, 'Estimate; measure'],
  ['Status LED', '5 ms pulse every 30 s (low) to 60 ms every 10 s (high) at 2 mA', 0.3, 12, 'Calculated'],
  ['Haptic prompts', '8 prompts/day, 2–8 s buzzing each at 60–90 mA', 11, 67, 'Calculated'],
  ['Piezo sounder', '8 prompts/day, 2–8 s sounding at 15–30 mA', 3, 22, 'Calculated']
];
const lowTotal = power.reduce((s, r) => s + r[2], 0), highTotal = power.reduce((s, r) => s + r[3], 0);
const days = (mAh, uA) => Math.round(mAh * 0.8 / (uA / 1000) / 24);
const fmt = n => n < 10 && n % 1 ? n.toFixed(1) : Math.round(n);

const failures = [
  ['Pendant out of Bluetooth range (bathroom, terrace, garden)', 'Detects and alarms locally, queues events, fast-advertises after urgent events so the phone or hub reconnects', 'Local-first firmware and queue exist; tune advertising on nRF54 EVT; add a hub near bathroom/bedroom'],
  ['Phone off, dead, Bluetooth off or airplane mode', 'Home Hub relays; cloud shows which path is down', 'Per-gateway credentials and health are built; Home Hub still to build'],
  ['App killed by the OS (Xiaomi, Oppo, Vivo, Samsung battery savers; iOS limits)', 'Native app: Android foreground service + CompanionDeviceManager + boot restart + guided battery/autostart exemptions; iOS background Bluetooth + state restoration', 'Replace the browser gateway with native apps'],
  ['Home Wi-Fi / broadband down', 'Phone relays on mobile data; hub fails over to LTE Cat-1 if fitted', 'Hub LTE option'],
  ['Power cut', 'Hub backup cell; phone keeps working on its battery', 'Hub backup option'],
  ['Parent leaves home', 'Phone relays wherever it goes; without the phone, no remote alert until V3 cellular', 'Say this plainly in onboarding'],
  ['Every path down', 'Pendant keeps protecting locally; after a grace window family and team are told protection is reduced', 'Built: team sees silence at once; family alerted after a per-parent window (default 15 min)'],
  ['Alert delivered but nobody responds', 'Push → SMS → voice call → next Care Circle contact → care team, each on a timer until acknowledged', 'Contact chain exists; add push, SMS and voice providers']
];

export function hardwarePage() {
  const powerRows = power.map(([item, assume, lo, hi, src]) => [item, assume, `${fmt(lo)}–${fmt(hi)} µA`, `<small>${src}</small>`]);
  powerRows.push(['<strong>Total estimate</strong>', 'Excludes pilot raw-data logging (expect a further ~5–20 µA)', `<strong>${Math.round(lowTotal)}–${Math.round(highTotal)} µA</strong>`, '']);
  return `<div class="page-heading"><div class="eyebrow">LOOMCARE · V1 hardware</div><h1>The V1 pendant, from bench to wearable.</h1><p>Product architecture, EVT parts list, power budget, connectivity strategy, and the ESP32 rig kept for software testing.</p></div>
<div class="notice warning"><strong>Engineering targets, not promises.</strong> Size, weight, IP rating and battery life are locked only after EVT prototypes, ingress tests and real power measurements. The pendant helps a family respond faster; it is not a certified medical device.</div>
<div class="grid three spaced"><div class="card metric"><span>Battery target</span><strong>10–21+ days</strong><small>Needs ≤ ~0.5 mA average</small></div><div class="card metric"><span>Size / weight target</span><strong>~35 × 31 × 10 mm</strong><small>~15–22 g</small></div><div class="card metric"><span>Sealing</span><strong>IP67 → IP68</strong><small>No USB port; cradle contacts</small></div></div>

<div class="row section-title"><div><h2>Product block diagram</h2><p>nRF54L15 + nPM1300 + BMI270. Shows function blocks, not final pins.</p></div><a class="btn" href="/static/architecture.svg" download="loomcare-v1-architecture.svg">Download SVG</a></div>
<a href="/static/architecture.svg" target="_blank" rel="noopener"><img class="hardware-image diagram" src="/static/architecture.svg" alt="Pendant block diagram: nPM1300 power management with cradle contacts and certified cell; nRF54L15 module connected to BMI270 motion sensor, optional ILPS28QSW barometer, DRV2605L haptic driver with LRA, PAM8904 piezo driver, sealed button, RGB LED and optional pilot flash."></a>

<div class="section-title"><h2>EVT parts list</h2><p>Your recommended direction, refined. Excluded from V1 on purpose: GPS, SIM, microphone, speaker, display, heart-rate, SpO₂.</p></div>
${table(['Function', 'Choice', 'Why', 'Alternative', 'Reference'], bom)}

<div class="section-title"><h2>Prototype build (finalized)</h2><p>Plain XIAO nRF54L15 + BMI270. Firmware: <code>hardware_code/pendant_nrf54</code>. Prices are planning figures; check live listings.</p></div>
${table(['Part', 'Role', 'Cost', 'Source'], devKits)}
<div class="section-title"><h2>Production cost target</h2><p>Bare chip with Nordic’s reference antenna layout, no barometer, no extra flash, no adapter in the box, Home Hub sold separately. Confirm with supplier quotes.</p></div>
${table(['Item', 'Estimate per unit'], production)}

<div class="section-title"><h2>Power budget</h2><p>Battery-side estimates from datasheet typicals and stated assumptions. Reminder vibration and LED policy matter as much as the chips.</p></div>
${table(['Contributor', 'Assumption', 'Average current', 'Basis'], powerRows)}
<div class="grid three spaced">${[145, 200, 300].map(mAh => `<div class="card metric"><span>${mAh} mAh cell · 80% usable</span><strong>~${days(mAh, highTotal * 1.5)} days</strong><small>Planning figure: high estimate × 1.5 margin · optimistic ceiling ${days(mAh, lowTotal)} days</small></div>`).join('')}</div>
<div class="notice spaced">The planning figures land inside the 10–21+ day target. The 1.5× margin covers what datasheets miss: reconnection storms, firmware bugs, cold weather and ageing. Claim a number only after running Power Profiler Kit II measurements on EVT boards through a realistic day. For comparison, the ESP32 rig would draw roughly tens of mA and last hours to a few days.</div>

<div class="row section-title"><div><h2>Solving connectivity</h2><p>V1 routes alerts through a gateway. Make that path redundant, supervised and honest.</p></div><a class="btn" href="/static/connectivity.svg" download="loomcare-connectivity.svg">Download SVG</a></div>
<a href="/static/connectivity.svg" target="_blank" rel="noopener"><img class="hardware-image diagram" src="/static/connectivity.svg" alt="Connectivity layers: local-first pendant, robust BLE link, native phone gateway, optional mains-powered home hub with Wi-Fi and LTE backup, cloud with deduplication and heartbeat supervision, and escalation by push, SMS and voice call."></a>
<div class="two-col spaced"><div class="card"><h3>The layers</h3><ol><li><strong>Local-first pendant.</strong> Detection, alarm, SOS and reminders never need a network. Events stay stored until the cloud confirms them.</li><li><strong>Robust BLE link.</strong> Slow connection when idle; fast advertising and +8 dBm transmit after a fall or SOS; Coded PHY to the hub; antenna tuned inside the enclosure.</li><li><strong>Native phone gateway.</strong> Built in the LOOMCARE phone app (<code>mobile/</code>): QR pairing, native Bluetooth, Android foreground service with guided battery-saver exemptions, iOS background Bluetooth with state restoration. Needs on-phone validation; restart-on-boot is still to add.</li><li><strong>Home Hub.</strong> A mains-powered BLE-to-Wi-Fi bridge near the bedroom or bathroom. Optional LTE backup and battery backup. Removes phone dependence at home, where most falls happen.</li><li><strong>Multi-gateway cloud.</strong> Built: up to four gateways per pendant, each with its own revocable credential and health; the pendant accepts two at once; duplicate relays create one incident.</li><li><strong>Supervision.</strong> Heartbeats; the team sees silence immediately; the family gets a calm "reduced protection" notice after a grace window. Charging or not-worn states are not alarms.</li><li><strong>Escalation.</strong> Push, SMS, then voice call, then the next contact, then the care team, until someone acknowledges.</li></ol></div><div class="card"><h3>Measure before you believe it</h3><ul><li>Walk-test every room in 5–10 real Indian homes, logging RSSI and packet loss with the pendant worn. Include bathrooms, kitchens, stairwells and terraces.</li><li>Compare phone-only against phone + hub, and 1M PHY against Coded PHY.</li><li>Test the top Android brands in your market, locked and idle overnight, and after a reboot.</li><li>Record fall/SOS-to-caregiver-notification latency (p50/p95) per path, and the time a home spends without any path.</li><li>Set a gateway-outage target, e.g. "under X minutes of unsupervised time per day", and track it on the team dashboard.</li></ul><p class="spaced"><small>V3 cellular (per the proposal) removes the gateway entirely. Until then, remote alerts need at least one working gateway, and the app must say so.</small></p></div></div>
${table(['Failure', 'Response', 'Status in this repository'], failures)}

<div class="section-title"><h2>Build path</h2></div>
<div class="steps"><section class="step"><div><span class="pill">Done</span><h3 class="spaced">Stage 0 · Software rig</h3><p>ESP32 bench rig plus the family app, gateway, team dashboard and backend. Validates workflows, not the hardware.</p></div></section><section class="step"><div><span class="pill">Firmware ready</span><h3 class="spaced">Stage 1 · XIAO nRF54L15 + BMI270 prototype</h3><p>Zephyr firmware compiles for the plain XIAO nRF54L15 (upstream Zephyr 4.4, open-source Bluetooth controller): accel-first fall detection with gyro bursts, 15 s cancel, 2 s SOS, stored reminders, check-ins, passkey-secured Bluetooth for up to two gateways at once, battery sensing and persistent event queue. Build 5–10 units and measure current with Power Profiler Kit II.</p><p><strong>Exit when:</strong> measured average current meets the budget, events reach the family app through phone and hub, and vibration and loudness satisfy older testers. Next power steps: BMI270 any-motion interrupt wake and a compact binary Bluetooth protocol.</p></div></section><section class="step"><div><span class="pill gray">Then</span><h3 class="spaced">Stage 2 · EVT-1 custom board and housing</h3><p>Module-based PCB, cradle contacts, 3D-printed or CNC sealed housing, antenna tuned in the enclosure, pilot flash fitted. Home walk-tests and first ingress tests.</p><p><strong>Exit when:</strong> size and weight are near target, BLE range is acceptable in real homes, and a full day is measured on battery.</p></div></section><section class="step"><div><span class="pill gray">Then</span><h3 class="spaced">Stage 3 · DVT and supervised pilot</h3><p>Tooled enclosure, IP67/68 and drop tests, battery safety, fall-detection validation with dummies and fixtures plus logged real-world activity, Home Hub in every pilot home, native apps.</p><p><strong>Exit when:</strong> targets are measured, certifications are in hand, and false alarms per wearer-day are acceptable to families.</p></div></section></div>
<div class="notice spaced"><strong>Indian compliance to plan for (confirm with a compliance consultant):</strong> BIS registration for the Li-ion cell (IS 16046) and for any supplied adapter; WPC equipment type approval for the Bluetooth product, which a WPC-certified module simplifies but does not replace; and a regulatory review of product claims before calling anything "medical".</div>

<details class="rig card spaced"><summary><strong>ESP32 software-testing rig</strong> · existing bench circuit, India parts list, firmware commands</summary><div class="spaced">${rigPage()}</div></details>`;
}
