# LOOMCARE locket hardware handbook

This folder is the human-readable starting point for selecting, assembling and validating the current hardware. Buildable source remains under `hardware_code/`.

## Current baseline

- Prototype controller: plain Seeed XIAO nRF54L15
- Motion sensor: BMI270 breakout at I²C address `0x68`
- Battery: protected 1S 200 mAh LiPo
- Outputs: vibration motor, piezo and RGB LED
- Input: one large button
- Firmware: [`../hardware_code/pendant_nrf54`](../hardware_code/pendant_nrf54)
- Target prototype cost: at most ₹3,000

## Build order

1. [`docs/01-design-baseline.md`](docs/01-design-baseline.md)
2. [`docs/02-bom-and-sourcing.md`](docs/02-bom-and-sourcing.md)
3. [`docs/03-wiring.md`](docs/03-wiring.md)
4. [`docs/04-assembly.md`](docs/04-assembly.md)
5. [`docs/05-firmware-and-pairing.md`](docs/05-firmware-and-pairing.md)
6. [`docs/06-validation.md`](docs/06-validation.md)
7. [`docs/07-change-control.md`](docs/07-change-control.md)

Use [`templates/build-record.md`](templates/build-record.md) for every unit and [`templates/test-record.md`](templates/test-record.md) for every verification run. These documents are engineering scaffolding, not certification evidence.
