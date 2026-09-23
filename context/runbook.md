# V1 Prototype Runbook

## Runtime

Python 3.10+ is required; the deployment image uses Python 3.12. There is no Node build step for the application. Runtime dependencies are in `requirements.txt`; Node is only used for browser tests.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:8000`. Register a family account, add a parent with a virtual pendant, and generate a gateway pairing link. Open it in a separate tab. The original `/run-prediction` endpoint returns 410 and cannot trigger old email alerts.

To provision the internal dashboard, run this from the same directory/environment; it prompts for a password of at least 12 characters:

```bash
flask --app app create-operator --email team@example.com
```

Use a separate browser/profile for the operator session. Registration cannot create an operator. Provisioning an existing email does not promote that account.

## Configuration

`app.py` loads a local `.env` if present. `.env.example` contains non-secret local defaults. Never commit real configuration.

| Variable | Meaning |
| --- | --- |
| `LOOMCARE_DATA_DIR` | Persistent database and development session-key directory; defaults to repository `data/` |
| `LOOMCARE_SECRET_KEY` | At least 32 random characters; required when secure cookies are enabled |
| `LOOMCARE_SECURE_COOKIES` | `1` for HTTPS deployment; default `0` for loopback development |
| `LOOMCARE_ENABLE_SMTP` | `0` by default: no external emails; `1` explicitly enables real delivery |
| `SMTP_HOST`, `SMTP_PORT` | TLS SMTP endpoint; default port 465 |
| `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_SENDER` | Provider credentials and verified sender; mandatory with SMTP enabled |
| `LOOMCARE_ENABLE_PUSH` | `1` sends Expo push alerts to Care Circle members who registered the phone app; default `0` |
| `EXPO_ACCESS_TOKEN` | Optional Expo push security token (when enhanced push security is on in the Expo account) |
| `LOOMCARE_ESCALATION_WEBHOOK_URL` | Optional `https://` endpoint of your SMS/voice provider bridge; receives signed JSON for fall/SOS notifications to contacts with a phone number |
| `LOOMCARE_ESCALATION_WEBHOOK_SECRET` | ≥ 32 characters; HMAC-SHA256 over `timestamp + "." + body`, sent as `X-Loomcare-Signature: sha256=…` with `X-Loomcare-Timestamp` |
| `PORT` | Local app port; default 8000 |

Development creates a persistent random `data/session.key` with owner-only file permissions. Deployment must use its own stable secret. Restarting with a different secret invalidates sessions. Gateway tokens are per gateway (up to four per pendant), SHA-256-hashed at rest, and revoked individually from the family app (owner) or team dashboard (admin). Pairing links are capabilities; do not publish them. Mobile sessions use 90-day bearer tokens (hashed at rest, revoked on sign-out or member removal); web sessions keep cookies + CSRF.

## Acceptance walkthrough

1. Register a family and add a simulated pendant. Open its gateway in another tab.
2. Send a family check-in. Within the next gateway sync, a prompt appears. Press the simulator confirmation button. Verify the timeline says acknowledged, not just delivered.
3. Start a possible fall, then cancel within 15 seconds. Verify only a cancelled warning, not an emergency notification.
4. Start another possible fall without cancellation. Verify a fall incident and durable inbox entry.
5. Press simulated SOS. Verify it bypasses the fall cancellation window. Acknowledge the incident and verify escalation stops.
6. Add two consenting test contacts. With SMTP disabled, allow an incident to exceed the configured interval and verify separate inbox records for each escalation destination. This does not send email.
7. Add a reminder for the next minute in IST. Acknowledge it on the pendant. The timeline records a reminder acknowledgement, never verified consumption.
8. Pause internet in the gateway. Trigger SOS. Verify the local queue grows and the cloud does not falsely claim receipt. Restore internet and verify replay creates a single incident.
9. Set simulated battery to 12%, then recover it. Verify low-battery and resolved states. Close the gateway: the team fleet view shows the pendant silent at once; the family gets “Pendant out of reach” only after the parent’s silence window (Settings, default 15 minutes).
10. Invite a caregiver and a viewer from Care Circle; sign up with each code in another browser profile and confirm what each role can and cannot change. Remove a member and confirm they lose access.
11. Add a second gateway (e.g. Home Hub) and verify both relay without duplicate incidents; remove one and confirm the other keeps working.
12. Sign into the operator workspace in another browser/profile. Inspect customers and household detail (add a support note), fleet and gateways, inventory (admin: add and assign a unit), incidents, delivery channels, team, audit and API p50/p95.

## Verification record (24 September 2026, platform release)

- 27 backend tests passed: the original 19 plus multi-gateway relay/dedup/revocation, tiered silence alerts, Care Circle roles and single-use invites, mobile bearer auth without CSRF, mocked Expo push with stale-token cleanup, signed webhook escalation, team roles/inventory/notes, and in-place migration of a pre-platform database. Writing these tests exposed an invite-join bug, which was fixed.
- Four real-browser journeys passed (installed Chrome), including a new Care Circle invite → sibling sign-up → role-limited view → team fleet/inventory/notes journey.
- The shared C++ detector tests passed, including the new accelerometer-only hard-impact path and a soft-bump rejection case.
- XIAO nRF54L15 + BMI270 firmware compiled with upstream Zephyr 4.4.2 and Zephyr SDK 1.0.1: 0 warnings, 189 KB flash (12%), 45 KB RAM (17%). It has **not** been flashed to a board; Bluetooth pairing, sensor behaviour, battery reading and current draw are unverified until bench tests.
- Mobile app: `tsc --noEmit` and `expo lint` clean; `expo-doctor` 20/21 (react-native-background-actions is untested on React Native’s New Architecture); Android prebuild manifest inspected (BLE `neverForLocation`, foreground service type `connectedDevice`, camera without audio, `loomcare://` scheme); Android production JS bundle exported. Not run on a physical phone; no EAS build performed.
- The live local server migrated the existing development database in place (browser gateway token moved to the gateways table; existing account became owner).

## Verification record (23 September 2026)

- 19 backend tests passed, including isolation, CSRF, replay deduplication, paused/missed reminders, escalation and mocked SMTP failures.
- Three real-browser journeys passed using installed Chrome, covering family/gateway/team workflows and a 390px mobile layout. Browser suspension/resume is still not an always-on service guarantee.
- The native C++ synthetic detector test passed. Python compilation, JavaScript syntax and installed dependency checks passed.
- Gunicorn ran locally with a healthy `/healthz` response. The Docker image was not built here because Docker is not installed; Render was not deployed.
- Local 140-sample warm benchmark: ingestion p50 0.885 ms / p95 1.000 ms; snapshot p50 1.125 ms / p95 1.441 ms. These are sequential in-process measurements, not an end-to-end SLA or concurrent-load result.
- Full ESP32 firmware compilation is **not verified**: PlatformIO's framework SDK download failed across multiple mirrors with incomplete reads / connection resets. The retrying download was stopped. Re-run the pinned PlatformIO build on a reliable connection before flashing or relying on the firmware. No physical board, battery, BLE, sensor or wearer trial was performed.

## Tests and latency measurements

```bash
python -m unittest discover -s tests -v
python tests/benchmark.py
node --check static/app.js
node --check static/gateway.js
node --check static/resources.js
npm ci
npx playwright install chromium
npm run test:e2e
```

If Chrome is already installed, `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` uses it with an isolated temporary browser profile. Browser tests launch a separate server on port 8011 backed by a temporary SQLite database. Fixture credentials exist only inside the test server; they are not application defaults. No test contacts a real email provider. Screenshots are written under `/tmp/loomcare-*.png`.

Run the pure C++ detector tests on a machine with Clang:

```bash
clang++ -std=c++11 -Wall -Wextra -pedantic tests/detector_test.cpp -o /tmp/loomcare-detector-test
/tmp/loomcare-detector-test
```

`tests/benchmark.py` reports 140 warm, sequential samples per route using the Flask test client and real temporary SQLite WAL. It excludes network, BLE, email, concurrent load, cold starts and human response. The live team dashboard displays rolling server-side request timings, also not end-to-end latency.

## Hardware and firmware

**Finalized hardware.** Prototype: plain Seeed XIAO nRF54L15 + BMI270 breakout + protected 200 mAh LiPo + coin vibration motor (transistor, flyback diode) + 12 mm piezo + large button + RGB LED + 3D-printed case with pogo-pin cradle (≈ ₹2,150–2,700; limit ₹3,000). Production: bare nRF54L15 + BMI270 + nPM1300 + DRV2605L/LRA + PAM8904/piezo + certified 150–200 mAh cell + cradle (≈ ₹1,300–1,950 at 1,000–2,000 units; limit ₹2,000). The `/hardware` page holds the BOMs, cost table, block diagram, power budget (38–185 µA estimate; planning ≈ 17/24/36 days for 145/200/300 mAh with a 1.5× margin), connectivity strategy and build path. Every current figure is an estimate until measured with Power Profiler Kit II.

**XIAO nRF54L15 firmware** (`hardware_code/pendant_nrf54`, Zephyr 4.4.2, open-source BLE controller, C with a small C++ bridge to the shared detector):

```bash
cd ~/zephyrproject && source .venv/bin/activate
export ZEPHYR_SDK_INSTALL_DIR=$HOME/zephyr-sdk/zephyr-sdk-1.0.1
west build -p always -b xiao_nrf54l15/nrf54l15/cpuapp -d /tmp/loom-nrf54-build ~/Documents/LOOMCARE/hardware_code/pendant_nrf54
west flash -d /tmp/loom-nrf54-build
```

Setup that produced a clean build: `west init -m https://github.com/zephyrproject-rtos/zephyr --mr v4.4.2`, then `west update --narrow -o=--depth=1 hal_nordic cmsis_6 cmsis mbedtls tf-psa-crypto picolibc`, `pip install -r zephyr/scripts/requirements-base.txt`, and the Zephyr SDK 1.0.1 minimal bundle with the ARM toolchain placed in `<sdk>/gnu/arm-zephyr-eabi`.

Wiring (XIAO labels): BMI270 on D4 SDA / D5 SCL at address 0x68 (change `reg` in the board overlay if your breakout straps 0x69); button D0 to GND (internal pull-up); vibration-motor transistor gate/base D1; piezo D2 (PWM, ≈ 2.7 kHz); RGB LED D3 / D8 / D9; LiPo on the XIAO battery pads. The onboard IMU, microphone and their bus are disabled in the overlay. Battery voltage uses the board’s switched divider on AIN7 (×2 ratio assumed; calibrate against a multimeter). First boot asks for a private 6-digit BLE PIN over USB serial (not echoed); the PIN persists in settings storage. The same newline-JSON protocol and UUIDs as the browser gateway are used; up to two gateways may be connected at once, and either can acknowledge an event. Detection is accelerometer-first with the gyro enabled for ~6 s after a candidate impact; the BMI270 any-motion interrupt and a compact binary protocol are the next power steps.

**Connectivity.** Local-first pendant; up to two simultaneous BLE gateways at the pendant and four registered per pendant in the cloud; per-gateway credentials and health; `(device, event id)` deduplication; tiered silence alerts (team immediately, family after the per-parent window); push → SMS/voice (webhook) → next contact escalation. A Home Hub build is designed but not implemented.

**ESP32 software-testing rig.** The collapsible section of `/hardware` includes India supplier references, procurement estimates, the GPIO map, assembly gates, and the downloadable `/static/circuit.svg`. Build a USB-powered bench circuit first. It targets classic ESP32-WROOM-32, not the original ESP8266. It exists to exercise software and is not product hardware.

```bash
python -m pip install platformio==6.1.18
pio run -d hardware_code/pendant -e esp32dev
pio run -d hardware_code/pendant -e esp32dev -t upload
pio device monitor -b 115200
```

After assembling and checking the optional protected battery/power-sense circuit, select `-e esp32battery` instead. PlatformIO pins the ESP32 platform and ArduinoJson dependency. The firmware uses Arduino's bundled BLE, Wire and Preferences libraries.

Critical details:

- MPU6050 AD0 must be connected to 3V3: IMU address 0x69, RTC address 0x68.
- All I2C pullups and GPIO signals are 3.3 V. All grounds are common.
- GPIO27 is the normally-open button; GPIO25/26 drive MOSFET gates for motor/buzzer; GPIO2 drives the status LED.
- Battery build: GPIO34 and GPIO35 read the protected battery and charger USB input through separate 100k/100k dividers, with 100nF from each midpoint to GND. Never connect those voltages directly to GPIOs.
- Use a documented load-sharing charger and protected cell approved for at least its 1 A charge rate. Verify JST polarity. Disconnect booster output before programming with computer USB; prevent backfeeding.
- USB-only firmware reports unknown battery/power. Battery firmware reports an approximate voltage-based percentage and external-power presence, not charge-current confirmation.
- RTC backup cell must match a non-charging module. Time is stored as UTC; daily schedules use fixed IST (+19800 seconds).
- First boot asks you to choose a private six-digit BLE PIN (100000–999999) over USB serial, followed by Enter. Input is not echoed or logged. Monitoring starts only after this one-time setup. The PIN persists in NVS; use it in the phone's Bluetooth pairing prompt. No universal BLE password is embedded. Characteristics require authenticated encryption.
- Web Bluetooth needs Chrome Android or supported desktop, HTTPS or localhost. iOS Safari is unsupported. Keep the gateway foreground and the screen awake. Browser suspension is not a reliable background service.
- Physical thresholds, battery runtime, thermal behaviour, enclosure, water resistance and BLE interoperability are unvalidated until tested on hardware. Use a dummy/fixture, not elderly people performing falls.

## HTTP and BLE contracts

Session endpoints: `GET /api/session`, `POST /api/register`, `/api/login`, `/api/logout`. Cookie mutations require the session's `X-CSRF-Token`.

Family endpoints (minimum Care Circle role in brackets): `GET /api/state`, `GET /api/members` [viewer]; `POST /api/events/:id/ack` [viewer]; `POST /api/devices/:id/checkin`, `/reminders`, `/contacts` (optional E.164 `phone`), `PATCH /api/reminders/:id`, `DELETE /api/contacts/:id` [caregiver]; `POST /api/devices`, `PATCH /api/devices/:id` (`escalation_seconds`, `offline_alert_seconds` 120–86400), `POST /api/devices/:id/gateways` (alias `/pair`; `kind` web|phone|hub), `DELETE /api/gateways/:id`, `POST /api/invites`, `PATCH|DELETE /api/members/:id` [owner]. Registration accepts an optional `invite` code.

Mobile: `POST /api/mobile/register|login` returns a bearer token; `GET /api/me`; `POST /api/push-tokens` (`ExponentPushToken[…]`, platform); `POST /api/mobile/logout` (optionally with `push_token`). Bearer requests skip CSRF.

Team: `GET /api/operator/metrics`, `/households`, `/households/:id`, `POST /api/operator/households/:id/notes` [support]; `GET /api/operator/inventory` [support]; `POST /api/operator/inventory`, `PATCH /api/operator/inventory/:serial`, `GET /api/operator/team`, gateway revocation [admin]. Operators can acknowledge incidents across households but cannot impersonate wearer acknowledgements. `flask --app app create-operator --email … --team-role admin|support`.

The gateway uses `Authorization: Bearer <gateway-token>` with `GET/POST /api/gateway/sync`; the response includes the `gateway` it authenticated. `connected: true` refreshes the pendant’s last-heard time and telemetry; `connected: false` from one gateway does not mark the pendant offline while another gateway heard it within 45 s. POST accepts up to 32 events, command receipts and device telemetry. Each event has a stable `id`, `kind`, optional `occurred_at` Unix seconds, and a `ref` for check-in/reminder acknowledgements. `accepted` IDs are removed from the gateway queue only after server confirmation. Database uniqueness prevents duplicate incidents on retry.

BLE service `8be12000-7e34-4b80-8fd8-7277a721e9bc` exposes TX notify/read `8be12001-...` and RX write-with-response `8be12002-...` (same suffix). Frames are newline-delimited JSON, transmitted in 20-byte chunks. Firmware event fields are `id`, `kind`, `at`, `ref`; the gateway converts `at` to API `occurred_at`. The pendant retains the oldest event until an `ack` command follows cloud acceptance.

Commands are `time`, `begin` (configuration version/count), `reminder`, `commit`, `checkin`, and `ack`. Schedule staging commits atomically after the advertised count is received. `config_received` confirms the configuration version. A `receipt` confirms command storage; a separate `checkin_ack` confirms a physical press. Reminder occurrence references use `<schedule-id>:<IST-epoch-day>`.

## Deployment

Run one process with threaded request handling. The workflow and optional SMTP workers live in that process; do not use Gunicorn preload, more than one worker, multiple replicas, or Flask's reloader.

```bash
gunicorn --bind 127.0.0.1:8000 --workers 1 --threads 8 --timeout 30 app:app
```

Docker (requires Docker installed):

```bash
docker build -t loomcare-v1 .
docker run --rm -p 127.0.0.1:8000:8000 -v loomcare-data:/app/data loomcare-v1
```

For remote access, use an HTTPS reverse proxy and secure cookies plus a strong stable session secret. Do not publish a debug server directly. The Render blueprint selects a paid persistent disk; review pricing before deployment. It does not enable SMTP or automatic deploys. No cloud account or infrastructure is provisioned by running local tests.

Back up SQLite through its backup API or after a clean stop; copying a live `.db` file without WAL state is not a valid backup. Validate restores before any pilot. The prototype does not implement retention, self-service deletion, password recovery, MFA, native mobile push, signed OTA, or high availability. Use synthetic customer information until these operational gates are addressed.

## Failure semantics and limits

- Fall detection is local. A confirmed fall is sent after the local cancellation window, not before. SOS bypasses that window.
- Offline devices cannot deliver a new caregiver check-in or a remote emergency alert until connectivity returns.
- Pendants store 32 events, gateways 256, and devices eight daily schedules. Overflow is visible, not unlimited storage. Cloud replay accepts timestamps from the last seven days; unknown device time is represented by null, never a made-up time or location.
- Server scheduling catches up the last 24 hours since a schedule became effective. Longer backend outages need operator review; old events replayed by the pendant retain their reported time.
- A reminder is missed after five minutes without a received acknowledgement; a check-in after two minutes. A late wearer acknowledgement can replace a missed status without claiming ingestion or wellbeing certainty.
- `available` means an in-app inbox entry exists; it does not mean read. SMTP `sent` means provider acceptance, not human receipt. Provider timeouts can yield duplicate email despite a stable Message-ID; delivery is at least once, not exactly once.
- Email retries are bounded to five, separate from API request latency. Acknowledged/resolved incidents cancel unsent attempts when claimed by the mail worker; a send already in flight cannot be recalled.
- Removing a gateway immediately rejects its token; other gateways keep working. Queued browser events remain under that device's IndexedDB key and phone-app events in AsyncStorage; do not clear storage while events are queued.

## Phone app (`mobile/`)

Expo SDK 57, Expo Router (`mobile/src/app`), TypeScript. One app with two modes chosen at first launch:

- **Family mode**: sign in or create an account (optional invite code), parent cards with live status, urgent-incident acknowledgement, check-ins, reminders, Care Circle and invites, and “Set up parent’s phone or Home Hub”, which creates a gateway credential and shows it as a QR code (`loomcare://gateway-pair?server=…&token=…`).
- **Parent-phone gateway mode**: scan the QR (or open/paste the link), enter the pendant PIN on Android (iPhone shows the system prompt), then the phone relays silently. Native BLE via `react-native-ble-manager`; Android foreground service (`connectedDevice`) via `react-native-background-actions`; persistent event/receipt queue; clock, schedule and check-in forwarding identical to the browser gateway.

```bash
cd mobile
npm ci
npx tsc --noEmit && CI=1 npx expo lint && npx expo-doctor
npx expo run:android            # development build on a USB-connected phone
npx eas-cli@latest build --profile development --platform android   # cloud build
```

Set `expo.extra.apiUrl` in `mobile/app.json` to your HTTPS server. Push alerts need an EAS project (`npx eas-cli@latest init` adds the project ID), FCM credentials for Android and an APNs key for iOS, plus `LOOMCARE_ENABLE_PUSH=1` on the server. BLE, camera and push do not work in Expo Go; use a development build. Use HTTPS (for example a tunnel) when testing against a laptop server; plain HTTP is blocked by default on phones.

Known limits: `react-native-background-actions` is untested on React Native’s New Architecture (expo-doctor warning) and must be verified on the Android phones you support; replace it with a small Expo native module if it misbehaves. Android makers’ battery savers can still stop the relay — the app guides users to allow background running. iOS can pause background relaying; BLE events wake the app briefly, but steady heartbeats need a Home Hub.
- The old dataset/model/ThingSpeak scripts are archived research assets, not part of V1. Their original secrets must be rotated before any legacy reuse; the V1 runtime does not import them.
