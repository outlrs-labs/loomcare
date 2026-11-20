# UX gap analysis

Assessment date: 11 November 2026. “Adjust” means a supported capability needs clearer presentation; “Build” means the capability does not yet exist end to end.

| UX area | Current repository | Decision |
| --- | --- | --- |
| Authentication | Web sessions, CSRF, mobile tokens, role checks | **Fits.** Keep and add recovery/MFA only after pilot operations are defined. |
| Elderly profile | Name and locket mode live on `devices` | **Partial.** Fits P0 identity; defer sensitive DOB/health fields until retention and privacy requirements exist. |
| Home safety summary | Device cards show battery, last heard, gateways and incidents | **Adjust.** Lead with “needs attention / no active critical alert,” never “safe” or “normal.” |
| Device integration | Browser BLE, native BLE, QR/link pairing, multi-gateway health | **Fits and exceeds brief.** Improve setup guidance and use customer-facing “locket.” |
| Activity logs | Events, received/occurred time, acknowledgements and delivery attempts | **Fits.** Separate routine Activity from actionable Alerts. |
| Alert severity | Urgent styling exists but routine/warning/critical are mixed | **Adjust.** Add one shared severity model and dedicated Alerts view. |
| Critical actions | Acknowledge with action note exists | **Partial.** Add clearer call/check guidance; direct phone calling depends on explicit, consented contact data. |
| Care Circle | Roles, single-use invites, contact escalation | **Fits.** Clarify that emergency contacts do not gain app access. |
| Hospitals | Not implemented | **Defer to P2.** A saved reference is useful only with verified data source and ownership. |
| Reminders | Offline daily schedules, missed/acknowledged states | **Fits and exceeds brief.** Keep medicine-consumption disclaimer. |
| Tutorials | Hardware and rollout pages exist, scattered | **Adjust.** Dedicated `hardware/` handbook is the canonical build/assembly source. |
| Battery alert | Low-battery event below 20%, resolves at 25% | **Fits.** Critical-battery tier is not defined; collect battery calibration data first. |
| Consumer directory | Household list/detail, fleet, incidents | **Partial.** Existing data supports IDs, connectivity and alerts; age/subscription fields are not invented. |
| Search/filter/sort/page | Directory is a static server-limited table | **Build P1.** Add query parameters and accessible controls before pilot scale. |
| Subscription details | No commercial plan model | **Build P1 only when plans are defined.** Until then show “Not configured,” never fake expiry. |
| Locket simulator | Virtual pendant exists inside browser gateway | **Adjust.** Add a dedicated multi-surface Locket Lab showing device, family and operations reactions while still using the real gateway API. |
| Notification delivery | Durable in-app records and optional bounded external delivery | **Fits and exceeds brief.** Continue distinguishing stored/sent/read/acknowledged. |

## Deliberate non-fit

The supplied concept includes age, health information, hospitals and plans. Those fields are not added merely to match a mock table. Each requires a data owner, lawful purpose, retention rule, edit flow and failure semantics. The V1 implementation prioritizes safety workflows that are already technically supported.
