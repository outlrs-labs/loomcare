# 05 — Firmware and pairing

## Build

```bash
cd ~/zephyrproject
source .venv/bin/activate
export ZEPHYR_SDK_INSTALL_DIR=$HOME/zephyr-sdk/zephyr-sdk-1.0.1
west build -p always -b xiao_nrf54l15/nrf54l15/cpuapp \
  -d /tmp/loom-nrf54-build \
  ~/Documents/LOOMCARE/hardware_code/pendant_nrf54
west flash -d /tmp/loom-nrf54-build
```

## First boot

1. Open the USB serial console.
2. Choose a private six-digit PIN when prompted. It is not echoed and persists in settings.
3. Record only that the PIN was provisioned; do not put the PIN in source control or the build record.
4. Pair the unit through a newly generated gateway credential.

## Functional smoke test

- Status telemetry reports firmware, battery and sensor/clock health.
- Tap cancels a candidate fall or acknowledges an active prompt.
- Two-second hold creates SOS without a cancellation delay.
- Reminder configuration is staged and acknowledged atomically.
- Events stay queued until the gateway returns an acknowledgement.
- Replaying the same event through two gateways creates one server incident.

Any BLE protocol modification requires matching changes in the browser gateway, Locket Lab and mobile gateway engine.
