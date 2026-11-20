# Consumer and operations UX guide

Status: product baseline for V1. Last reviewed: 11 November 2026.

## Product promise

LOOMCARE helps a family understand three things quickly:

1. Is my loved one reporting a problem?
2. Is the locket connected and able to relay updates?
3. What action, if any, should I take now?

The experience must feel calm, reliable and human. It must never turn connectivity into proof of wellbeing or a sensor signal into a medical certainty.

## Stable product structure

### Consumer App

Used by family members and caregivers. The primary mobile navigation is:

- **Home** — safety summary, locket status, battery, last sync and the next action.
- **Activity** — chronological device, reminder and care history.
- **Alerts** — severity-grouped incidents that may require action.
- **Reminders** — local daily schedules and response status.
- **Profile** — elderly profiles, Care Circle, permissions, device setup, tutorials and account settings.

The web family experience may expose more management detail, but uses the same language and state model.

Engineering documentation, including the hardware build guide, must not appear in consumer or care-team navigation, onboarding or sign-in screens. Developers access it directly at `/hardware` or through `hardware/README.md` in the repository.

### System Dashboard

Used by authorized operations staff:

- Overview and KPIs
- Consumer directory and detail
- Connection and gateway monitoring
- Alert desk and delivery status
- Device inventory
- Subscription details when commercial plans are introduced
- Team roles and audit trail

## State language

### Connection

- **Connected** — a gateway recently reported that it can hear the locket.
- **Not heard recently** — the last known connection is stale.
- **Not connected yet** — the system has never received a heartbeat.
- **Unknown** — the system cannot verify state. Never render this as healthy.

Always show the time of the last report next to the state.

### Alert severity

- **Informational** — synchronized, reminder completed, check-in answered, fall warning cancelled.
- **Warning** — low battery, locket disconnected, missed reminder/check-in, sensor fault.
- **Critical** — possible fall or SOS.

A critical alert leads with the person's name, event, time, last known connection and clear actions. Use “Possible fall,” never “Fall confirmed.” Delivery states must distinguish queued, accepted by the server, provider-sent and acknowledged by a human.

## Core journeys

### First setup

1. Explain the benefit and limitations.
2. Create or sign into a caregiver account.
3. Create the elderly person's profile and emergency contacts.
4. Pair a parent phone, browser gateway or Home Hub.
5. Connect the locket over Bluetooth.
6. Confirm live connection, battery and a test event.
7. Offer wearing, charging and troubleshooting guidance.

### Critical incident

1. The locket detects a candidate fall locally and provides a 15-second cancellation window; SOS is immediate.
2. A gateway queues the event until the server accepts it.
3. Family receives a critical alert with honest timing and connection information.
4. The caregiver calls or arranges an in-person check, then records that action.
5. Acknowledgement stops future escalation but does not claim safety was verified.

### Care Circle

Inviting a person grants only the selected role. Owner, caregiver and viewer permissions remain explicit. Emergency contacts can receive escalation without automatically receiving app access or private history. Hospitals, when introduced, are saved references and do not imply an operational partnership.

## Visual direction

- Background: `#FFFFFF` and `#F3F5F4`
- Primary text: `#171B1A`
- Secondary text: `#64716E`
- Trust/action green: `#187D68`
- Critical red: `#D44C45`

Use generous space, readable typography, large touch targets, visible text labels and high contrast. Never rely on red/amber/green alone. Operations screens may be denser, but retain plain labels and scannable rows.

## Content rules

- Say **locket** in customer-facing setup text and **pendant/device** where engineering precision is useful.
- Say **last heard** or **last synchronized**, not “live,” unless a current heartbeat proves it.
- Say **possible fall**, **SOS pressed**, **reminder acknowledged**, and **notification sent/queued**.
- Do not say safe, normal, monitored continuously, medicine taken, emergency services contacted or medically validated unless independently proven.
- Use test identities and simulated events in demonstrations.

## Accessibility and failure handling

- Minimum 44 px touch targets; current mobile components use 52 px.
- Status has an icon/text label in addition to color.
- Critical actions remain visible without horizontal scrolling.
- Loading, empty, offline, revoked-pairing and delayed-data states have specific recovery text.
- The gateway explains that local alarms continue when cloud connectivity is lost.
- iOS background limits and Android battery-optimization risks are explained during gateway setup.
