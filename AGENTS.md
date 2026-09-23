# LOOMCARE — agent notes

## Layout
- `app.py` → `care.py` (Flask + SQLite WAL, schema in `schema.sql`, in-place migrations in `migrate()`).
- `static/` — web family app, team dashboard, browser gateway/simulator, hardware and plan pages (no build step).
- `mobile/` — Expo SDK 57 React Native app (family mode + invisible parent-phone gateway). Has its own `AGENTS.md`; use `npx expo install`, Expo Router in `mobile/src/app/`.
- `hardware_code/pendant_nrf54/` — product-direction firmware for plain XIAO nRF54L15 + BMI270 (Zephyr). `hardware_code/pendant/` — ESP32 software-testing rig. Both share `hardware_code/pendant/include/fall_detector.h`.

## Verify
```bash
.venv/bin/python -m unittest discover -s tests          # backend (27 tests)
clang++ -std=c++11 -Wall -Wextra -pedantic tests/detector_test.cpp -o /tmp/det && /tmp/det
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e              # 4 browser journeys, temp DB on :8011
cd mobile && npx tsc --noEmit && CI=1 npx expo lint && npx expo-doctor
```
Firmware (toolchain in `~/zephyrproject`, SDK in `~/zephyr-sdk/zephyr-sdk-1.0.1`):
```bash
cd ~/zephyrproject && source .venv/bin/activate && export ZEPHYR_SDK_INSTALL_DIR=$HOME/zephyr-sdk/zephyr-sdk-1.0.1
west build -p always -b xiao_nrf54l15/nrf54l15/cpuapp -d /tmp/loom-nrf54-build ~/Documents/LOOMCARE/hardware_code/pendant_nrf54
```

## Rules of thumb
- Tests must never send real email/push/webhook traffic (mock `care.urllib.request.urlopen`, `care.smtplib`).
- Keep the BLE line protocol (newline JSON, 20-byte chunks) identical across firmware, `static/gateway.js` and `mobile/src/gateway/engine.ts`.
- Cost limits: prototype ≤ ₹3,000/unit, production ≤ ₹2,000/unit (see `/hardware`).
