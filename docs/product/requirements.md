# Product requirements

Status: approved V1 baseline derived from the supplied UX context. Requirement IDs are stable and should be referenced by tests, issues and design reviews.

## P0 — essential

| ID | Requirement | Acceptance |
| --- | --- | --- |
| AUTH-01 | A caregiver can register, sign in and sign out securely. | Web uses protected sessions and CSRF; mobile uses revocable bearer tokens. |
| PROF-01 | An owner can create an elderly-person profile. | Name and locket mode are required; profile appears only inside its household. |
| PAIR-01 | An owner can create and revoke a gateway pairing. | Up to four per locket; token is shown once and stored hashed by the server. |
| STAT-01 | Home shows connection, last sync, battery and active attention items. | Unknown/never-connected is distinct from connected. |
| ALRT-01 | Events are separated into informational, warning and critical severity. | Possible fall and SOS are critical; low battery/disconnection/missed response are warning. |
| ALRT-02 | Critical alerts expose immediate response actions. | Person, event, timestamp, connection context and acknowledge/call guidance are visible. |
| ALRT-03 | Delivery and acknowledgement are not conflated. | Queued, accepted/available, sent and acknowledged language is explicit. |
| CIRC-01 | Owners can invite trusted members with explicit permissions. | Owner/caregiver/viewer enforcement exists server-side. |
| CONT-01 | Caregivers can maintain ordered emergency contacts. | Contact consent is stated; access to app history is not granted automatically. |
| OPS-01 | Authorized operators can list and open consumer households. | Table shows stable ID/name, device count, connection state, last activity and alerts. |
| PRIV-01 | Household data is isolated and operator actions audited. | Cross-household family access is rejected; relevant changes create audit rows. |
| SIM-01 | Product teams can test locket scenarios without physical hardware. | Simulator can generate fall/SOS, battery and connectivity states and explains which effects are local previews versus server events. |

## P1 — important

| ID | Requirement | Acceptance |
| --- | --- | --- |
| LOG-01 | Activity history shows event time, sync delay and resolution. | Replayed events retain reported time or explicitly show unknown device time. |
| REM-01 | Caregivers can create, pause and review reminders. | Daily IST schedule is stored on the locket; acknowledgement is not medication proof. |
| TUT-01 | Setup, wearing, charging and troubleshooting guidance is easy to find. | Guides are reachable from Profile and hardware handbook. |
| SUB-01 | Operations can view service plan, activation and expiry when commercial plans exist. | Unknown/unconfigured is displayed honestly; expiry has a defined failure state. |
| DEL-01 | Operations can inspect notification attempts and failures. | Channel, outcome, attempt count and error are visible. |
| PROF-02 | Elderly profiles can hold essential non-medical details. | Data minimization and retention are defined before adding DOB, address or health data. |

## P2 — future

- Advanced activity insights supported by validated sensor data.
- Granular per-member data permissions beyond the current role model.
- Saved hospital references with verified contact/location sources.
- Automated operational reporting and commercial subscription automation.
- Cellular locket or Home Hub integrations.

## Non-functional requirements

- Local fall/SOS/reminders continue without internet.
- The locket stores 32 events; gateways replay accepted events idempotently.
- No test sends real push, email or webhook traffic.
- Prototype cost is at most ₹3,000 per unit; production target is at most ₹2,000.
- UI text does not claim medical certification, emergency dispatch or guaranteed safety.
- Browser and mobile paths use the same event, permission and severity vocabulary.
