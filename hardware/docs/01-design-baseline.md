# 01 — Design baseline

Revision: PROTO-NRF54-01. Status: prototype direction; not frozen production hardware.

## Purpose

A neck-worn locket that detects candidate falls locally, provides a 15-second cancel period, supports a 2-second SOS press, runs daily reminders and queues events until a gateway confirms receipt.

## Architecture

- XIAO nRF54L15 provides BLE, compute, storage, USB development and battery sensing.
- BMI270 provides 50 Hz accelerometer data and short gyro bursts after candidate impacts.
- A single button handles cancel/acknowledge and SOS.
- Haptic, piezo and LED provide redundant feedback.
- The parent phone, browser gateway or Home Hub carries encrypted BLE events to the server.

## Design constraints

- Prototype ≤ ₹3,000; production target ≤ ₹2,000.
- No GPS, SIM, microphone, display, heart-rate or SpO₂ in V1.
- Local alarms and queued events work without internet.
- Size, battery life, water resistance and fall accuracy are unverified until physical tests.
- Never conduct intentional fall tests with an elderly wearer; use fixtures and dummies.

## Interfaces that hardware revisions must preserve

- BLE service and TX/RX UUIDs documented in `context/runbook.md`.
- Newline-delimited JSON in 20-byte BLE writes.
- Event kinds: fall, SOS, fall cancelled, reminder/check-in acknowledgement and device fault.
- Persistent 32-event device queue and up to eight reminder schedules.
