# Implementation plan

This is the delivery order. Later phases must not bypass earlier acceptance gates.

## Phase 1 — UX baseline and product structure

Status: implemented in this change.

- Establish this UX guide, requirement IDs and gap analysis.
- Keep Consumer App and System Dashboard as fixed product interfaces.
- Add a dedicated Alerts screen and align mobile labels to Home, Activity, Alerts, Reminders and Profile.
- Use one severity model: informational, warning and critical.
- Add the Locket Lab simulator using the real gateway synchronization contract.
- Create the `hardware/` handbook without moving buildable firmware.
- Add links from the product UI and root README.

Acceptance: backend, detector, browser journeys, mobile typecheck/lint/doctor and firmware build remain the verification targets documented in `AGENTS.md`.

## Phase 2 — guided onboarding and profile completeness

Status: planned.

- Create a progress-based onboarding checklist: profile → contact → gateway → Bluetooth → test alert.
- Add essential elderly-profile fields only after privacy/retention review.
- Add in-app wearing, charging and troubleshooting tutorials sourced from `hardware/`.
- Add an explicit “send test alert” completion gate.

Exit: a first-time owner can complete setup without operator assistance and can explain what happens offline.

## Phase 3 — operations directory and service model

Status: planned.

- Add server-side search, filters, sort and cursor pagination.
- Define “connected uses” before adding the metric.
- Introduce subscription plan/start/expiry only after commercial rules and expired-plan safety behaviour are approved.
- Export operational records with access audit and minimised fields.

Exit: operations can find a consumer quickly and no missing value is rendered as healthy or active.

## Phase 4 — hardware evidence and pilot readiness

Status: planned; blocked on physical units and measured evidence.

- Build 5–10 XIAO nRF54L15 + BMI270 prototypes using the handbook.
- Record power, BLE range, alert latency, ingress, drop, haptic and acoustic results.
- Validate background gateway behaviour on representative Android devices and iOS.
- Freeze EVT hardware only through the change-control record.

Exit: cost, battery, connectivity and enclosure claims are based on signed test records rather than estimates.

## Change discipline

- Every feature maps to a requirement ID.
- Every hardware revision gets a build record and change note.
- Unsupported concept fields remain documented gaps, not sample production data.
- Any BLE contract change ships atomically across both firmware targets and both gateways.
