# 06 — Validation gates

These are prototype gates, not medical-device validation.

## Electrical and power

- No abnormal heat during charging or alert output.
- Battery reading is compared with a calibrated multimeter at multiple voltages.
- Power Profiler II records idle, BLE connected, advertising, fall sequence, SOS and reminder profiles.
- Estimated runtime uses measured duty cycles and an explicit margin.

## Connectivity

- Walk-test representative bedrooms, bathrooms, kitchens, stairs and terraces.
- Record RSSI, reconnect time, packet loss and event-to-server latency.
- Test parent phone only and parent phone + Home Hub.
- Repeat with phone locked, app backgrounded, after reboot and with internet interrupted.

## Human factors

- Button can be found and pressed by older participants without looking.
- Haptic and acoustic feedback are distinguishable in a closed enclosure.
- Text and instructions are understandable without engineering assistance.
- Lanyard and enclosure have no sharp, hot or entanglement hazards.

## Reliability

- Fixture-based drop tests, queue replay and repeated charging cycles.
- Sensor fault, clock fault, low battery, gateway loss and queue overflow are visible in software.
- Candidate-fall tests use fixtures/dummies; record false alarms during ordinary wear separately.

Use the test-record template for every run, attach raw evidence and mark failures rather than editing them away.
