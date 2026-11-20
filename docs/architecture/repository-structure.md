# Repository structure

The product boundary is deliberately stable: one backend, one consumer mobile app, one browser application, and interchangeable gateway/hardware implementations.

```text
LOOMCARE/
├── app.py, care.py, schema.sql     # Flask API, workflows and SQLite schema
├── static/                         # family web, operations web, gateway and simulator
├── mobile/                         # Expo consumer app + parent-phone gateway mode
├── hardware/                       # human-readable hardware handbook and records
├── hardware_code/                  # buildable firmware sources
│   ├── pendant_nrf54/              # product-direction XIAO nRF54L15 firmware
│   └── pendant/                    # ESP32 software-test rig
├── docs/                           # product requirements, UX and architecture decisions
├── tests/                          # backend, protocol, detector and browser journeys
├── context/                        # historical architecture/runbook material
├── training_scripts/, dataset/     # archived fall-model research; not in V1 runtime
└── location_scripts/               # archived location-alert research; not in V1 runtime
```

## Rules

1. Consumer App and System Dashboard remain the two primary product interfaces.
2. Hardware can change behind the newline-JSON BLE contract. Any protocol change must be coordinated across firmware, `static/gateway.js`, `static/simulator.js` and `mobile/src/gateway/engine.ts`.
3. `hardware/` explains how to select, assemble and validate hardware. `hardware_code/` contains only buildable source and board configuration.
4. Archived ML, ThingSpeak and location scripts must not be imported into the V1 startup or alert path.
5. Product decisions belong in `docs/product/`; measured hardware evidence belongs in `hardware/records/`.
