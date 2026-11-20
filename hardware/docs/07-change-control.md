# 07 — Hardware change control

Hardware is expected to evolve. Changes are allowed only when their software, safety, cost and evidence impact is visible.

## Change classes

- **Equivalent sourcing:** same function and electrical limits; record supplier/lot and inspection.
- **Electrical substitution:** pinout, voltage, current, sensor or radio change; requires review and regression tests.
- **Mechanical revision:** enclosure, button, lanyard, seal or antenna environment; requires human-factor/connectivity retest.
- **Protocol change:** BLE UUID, framing or message fields; requires atomic firmware and gateway updates.

## Change note

Record:

- change ID, date and owner
- reason and requirement affected
- before/after part numbers or drawings
- cost and availability impact
- firmware/gateway changes
- safety and privacy impact
- tests to repeat and their evidence links
- approval and rollback plan

Do not call a revision “final” until its exit criteria and evidence are signed. Update the baseline revision in `01-design-baseline.md` only after approval.
