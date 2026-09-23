# Repository Context

## Current V1 prototype

- `app.py` now creates the Flask care application in `care.py`; legacy inference is not loaded.
- Three responsive browser interfaces: family/customer app, parent gateway with BLE and virtual pendant, and operator dashboard.
- SQLite WAL stores households, hashed-password users, devices, hashed gateway tokens, daily IST reminders, contacts, commands, incidents, notification attempts and audit records.
- Device event ingestion is authenticated and idempotent. Wearer acknowledgements are separate from transport receipts and caregiver incident acknowledgements.
- Local ESP32 firmware is in `hardware_code/pendant/`, with staged schedule synchronisation, RTC time, persistent queues, physical SOS and cancellation controls.
- The downloadable circuit and India sourcing guide are available at `/hardware`; the consumer/native app refinement and team operations plan is at `/plan`.
- Tests and test commands are in the updated runbook. SMTP is opt-in and tests use only mocked/disabled delivery.
- Deployment is a single Gunicorn process plus persistent disk. Native mobile background BLE/push, field-validated fall accuracy, battery life, enclosure/water resistance and production operations remain explicit gates.

## Archived pre-V1 baseline

The sections below document the original snapshot, before the current prototype. In particular, statements that web clients or automated tests are missing refer only to that old snapshot.

## One-sentence summary

LOOMCARE is a fall-detection prototype that reads a six-sample motion window from
ThingSpeak, extracts 48 statistical features, classifies the window with a saved
scikit-learn model, and, when a fall is predicted, looks up nearby medical
facilities and sends an email alert.

## What this folder is about

The repository combines five kinds of material:

1. A small Flask API that starts the prediction workflow.
2. A machine-learning inference pipeline and saved model artifacts.
3. Training and model-comparison scripts backed by a 368,032-row sensor dataset.
4. ESP8266 firmware that reads motion and heart-rate sensors and prints readings
   to the serial console.
5. Supporting project artifacts: a report, presentation, demo videos, deployment
   configuration, and a product-level README.

The root README describes a broader completed product containing a wearable,
ThingSpeak integration, a cloud backend, a Flutter application, GPS, temperature,
and generative-AI health translation. The checked-in code is narrower. In
particular, this snapshot does not contain a Flutter project, a Gen-AI module,
the documented `/api/*` routes, firmware that uploads to ThingSpeak, or firmware
for GPS and temperature sensors.

## Current implementation status

| Area | Observed in this repository | Status |
| --- | --- | --- |
| Flask backend | `/` health response and token-protected `GET /run-prediction` | Implemented prototype |
| Fall inference | Fetch, feature extraction, scaling, Random Forest prediction | Implemented prototype |
| Alerting | Nearby-facility lookup through Overpass and Gmail SMTP email | Implemented, externally dependent |
| Model training | Random Forest training plus comparison/experimental scripts | Implemented, not fully reproducible from `requirements.txt` |
| Hardware | ESP8266 reads MPU6050 and MAX30100, then prints to serial | Partial |
| ThingSpeak publishing | No upload logic in the checked-in firmware | Missing |
| GPS and temperature firmware | Mentioned in README but absent from firmware | Missing |
| Mobile application | Mentioned in README but no Flutter folder is present | Missing from this snapshot |
| Gen-AI health translation | Mentioned in README but no implementation is present | Missing |
| Tests and CI | No automated test suite or CI configuration | Missing |
| Render deployment | `render.yaml` starts `gunicorn app:app` | Configured, live state unverified |

## Runtime behavior

The active backend entry point is `app.py`.

- `GET /` returns a health message.
- `GET /run-prediction?token=...` compares the query token with
  `API_SECRET_TOKEN` and calls `predict_fall_and_alert()`.
- The inference module asks ThingSpeak for exactly six sensor records.
- Each record must expose accelerometer values in fields 1–3 and gyroscope values
  in fields 4–6.
- The service calculates six statistics for eight signals: mean, standard
  deviation, maximum, minimum, skew, and kurtosis. That produces 48 features.
- The saved scaler and model transform and classify that feature vector.
- A non-fall returns JSON immediately.
- A fall fetches latitude/longitude from a second ThingSpeak channel, falls back
  to default coordinates on error, queries Overpass for nearby facilities, and
  attempts to send an email through Gmail SMTP.

Important: calling the live prediction route can send a real alert email if the
model predicts a fall.

## Data contracts

### Sensor channel

| ThingSpeak field | Runtime name | Expected meaning |
| --- | --- | --- |
| `field1` | `ax` | X-axis acceleration |
| `field2` | `ay` | Y-axis acceleration |
| `field3` | `az` | Z-axis acceleration |
| `field4` | `gx` | X-axis gyroscope signal |
| `field5` | `gy` | Y-axis gyroscope signal |
| `field6` | `gz` | Z-axis gyroscope signal |

### GPS channel

| ThingSpeak field | Meaning |
| --- | --- |
| `field1` | Latitude |
| `field2` | Longitude |

### Environment variables

| Variable | Used by | Required |
| --- | --- | --- |
| `API_SECRET_TOKEN` | Flask route authorization | Yes in any real deployment; code currently has an insecure default |
| `ALERT_EMAIL_SENDER` | Gmail SMTP login/from address | Required to send alerts |
| `ALERT_EMAIL_PASSWORD` | Gmail SMTP credential | Required to send alerts |
| `ALERT_EMAIL_RECEIVER` | Emergency-contact destination | Required to send alerts |

ThingSpeak channel IDs and read keys are currently constants in
`fall_detection.py`; Wi-Fi credentials are constants in the Arduino sketch.
They should be rotated and moved out of source control before further use.

## Important engineering gaps

1. **Secrets:** credentials/keys are hard-coded, the API token has a default, and
   the email module prints the loaded email address and password.
2. **Train/serve consistency:** training uses `pandas.Series.std()` (sample
   standard deviation), while inference uses `numpy.std()` (population standard
   deviation). Training also uses dataset `droll/dpitch/dyaw` signals while the
   firmware exposes `gx/gy/gz`. A shared feature pipeline is needed.
3. **Hardware-to-cloud link:** the firmware logs locally but does not publish the
   fields consumed by the backend.
4. **Side effects over GET:** `/run-prediction` can send email from a GET request.
   This should become a validated POST operation or a scheduled worker.
5. **Failure reporting:** SMTP failures are logged but not propagated; the API may
   report a detected fall without reporting whether the alert was delivered.
6. **Reproducibility:** runtime dependencies exist, but training needs additional
   packages (`pandas`, and optionally `xgboost`/`openpyxl`) and no versions are
   pinned.
7. **Path sensitivity:** model files are loaded with paths relative to the current
   working directory, so the service must currently start from the repository
   root.
8. **Documentation drift:** the root README documents routes and components that
   are not present in this snapshot.

## Source of truth

Use this order when facts disagree:

1. Executable code and checked-in configuration.
2. Saved model/data artifacts and their generating scripts.
3. This context pack.
4. Product claims in the root README, report, presentation, and videos.

The broader materials are useful for product intent, but should not be treated as
proof that a component is implemented in this folder.
