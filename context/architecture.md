# Architecture Graphs

## Current V1

```mermaid
flowchart LR
    P[ESP32 pendant\nlocal fall sequence, SOS, reminders, RTC, NVS] -->|encrypted BLE| G[Foreground parent browser gateway]
    S[Virtual pendant simulator] --> G
    G -->|device bearer token, idempotent events| API[Flask care.py]
    API --> DB[(SQLite WAL\npersistent disk)]
    DB --> W[Workflow thread\n1-second tick]
    W --> IN[Durable household inbox]
    W --> MAIL[Optional SMTP outbox\nseparate retry thread]
    API --> F[Family customer app\n2-second foreground refresh]
    API --> T[Team operator dashboard]
    F -->|schedules, contacts, check-ins| API
    API -->|staged commands and schedules| G
    G -->|20-byte framed writes| P
```

The gateway caches events in IndexedDB; the pendant retains its oldest event until cloud acceptance is acknowledged. Caregiver incident acknowledgement stops future escalation. A command receipt is not a wearer response. `GET /healthz` checks database access and the worker heartbeat. The old model is not on the V1 path.

Product hardware direction and the connectivity/fallback design are drawn in `static/architecture.svg` and `static/connectivity.svg` and explained on `/hardware`. They are targets, not implemented firmware.

This is a single-host, one-process prototype, not a high-availability architecture. Browser suspension can interrupt the gateway. See `/plan` for the native/background gateway, notification, validation and operations gates.

## Archived pre-V1 graphs

The remaining diagrams describe the old ThingSpeak/Random Forest demo, not current runtime wiring.

## 1. Current implemented runtime

Solid nodes are present in code. The dashed publishing connection is the missing
link between the checked-in firmware and ThingSpeak.

```mermaid
flowchart LR
    subgraph Device[Wearable prototype]
        MPU[MPU6050<br/>motion]
        HR[MAX30100<br/>heart rate]
        ESP[ESP8266 sketch]
        SERIAL[Serial console]
        MPU --> ESP
        HR --> ESP
        ESP --> SERIAL
    end

    ESP -. upload logic absent .-> TS_SENSOR[(ThingSpeak<br/>sensor channel)]

    subgraph Backend[Flask backend]
        API[GET /run-prediction]
        FETCH[Fetch latest 6 samples]
        FEATURES[Build 48 features]
        SCALE[Saved StandardScaler]
        MODEL[Saved Random Forest]
        DECISION{Fall?}
        API --> FETCH --> FEATURES --> SCALE --> MODEL --> DECISION
    end

    CLIENT[Caller or scheduler] -->|token in query| API
    TS_SENSOR -->|fields 1-6| FETCH
    DECISION -->|No| RESPONSE[JSON: fall_detected false]
    DECISION -->|Yes| GPS[(ThingSpeak<br/>GPS channel)]
    GPS --> ALERT[Alert workflow]
    ALERT --> OVERPASS[Overpass API<br/>nearby facilities]
    ALERT --> SMTP[Gmail SMTP]
    SMTP --> CONTACT[Emergency contact]
    ALERT --> FALL_RESPONSE[JSON: fall_detected true<br/>plus location]
```

## 2. Prediction and alert sequence

```mermaid
sequenceDiagram
    autonumber
    actor Caller
    participant API as Flask API
    participant Sensor as ThingSpeak sensor channel
    participant ML as Scaler + model
    participant GPS as ThingSpeak GPS channel
    participant Map as Overpass API
    participant Mail as Gmail SMTP

    Caller->>API: GET /run-prediction?token=...
    API->>API: Validate API_SECRET_TOKEN
    API->>Sensor: Request latest 6 feeds
    Sensor-->>API: fields 1-6
    API->>API: Extract 48 statistical features
    API->>ML: Transform and predict
    ML-->>API: class 0 or 1
    alt no fall
        API-->>Caller: success, fall_detected=false
    else fall
        API->>GPS: Request latest feed
        GPS-->>API: latitude and longitude
        API->>Map: Find hospitals within 2 km
        Map-->>API: Up to 5 named facilities
        API->>Mail: Send alert email
        Mail-->>API: SMTP result is only logged
        API-->>Caller: success, fall_detected=true, location
    end
```

## 3. Model lifecycle

```mermaid
flowchart LR
    XLSX[data_all.xlsx] -->|conversion utility<br/>needs path correction| CSV[fall_dataset.csv<br/>368,032 records]
    CSV --> CLEAN[Rename columns<br/>map labels<br/>drop invalid rows]
    CLEAN --> WINDOW[6-row windows<br/>50% overlap]
    WINDOW --> TRAIN_FEATURES[48 statistical features]
    TRAIN_FEATURES --> TRAIN_SCALE[Fit StandardScaler]
    TRAIN_SCALE --> TRAIN[Train/evaluate classifiers]
    TRAIN --> MODEL_FILE[models/fall_detection_model.pkl]
    TRAIN_SCALE --> SCALER_FILE[models/scaler.pkl]

    LIVE[Latest 6 ThingSpeak samples] --> SERVE_FEATURES[48 statistical features]
    SERVE_FEATURES --> SCALER_FILE
    SCALER_FILE --> MODEL_FILE
    MODEL_FILE --> PREDICTION[Fall / non-fall]

    TRAIN_FEATURES -. must be made identical .-> SERVE_FEATURES
```

The dotted edge is an important constraint, not a current guarantee. Feature
creation is duplicated between training and inference and already differs in
standard-deviation behavior.

## 4. Intended complete product

This is the target architecture implied by the product README, with missing or
partial repository components explicitly labeled.

```mermaid
flowchart TB
    subgraph Wearable[Wearable device]
        MOTION[Motion sensor]
        PULSE[Heart-rate / SpO2 sensor]
        TEMP[Temperature sensor<br/>missing in firmware]
        GPS_HW[GPS module<br/>missing in firmware]
        MCU[ESP8266]
        MOTION --> MCU
        PULSE --> MCU
        TEMP --> MCU
        GPS_HW --> MCU
    end

    MCU -->|secure telemetry upload<br/>missing in firmware| IOT[(ThingSpeak or IoT ingestion)]
    IOT --> WORKER[Scheduled/event-driven<br/>inference service]
    WORKER --> ML[Versioned fall model]
    ML --> EVENTS[(Fall event store<br/>not present)]
    EVENTS --> ALERTS[Reliable alert service]
    ALERTS --> CONTACTS[Emergency contacts]
    ALERTS --> FACILITIES[Nearby facilities]

    API_V2[Authenticated product API] --> IOT
    API_V2 --> EVENTS
    MOBILE[Flutter app<br/>not in repository] --> API_V2
    HEALTH_AI[Health interpretation<br/>not in repository] --> API_V2
    OBS[Logs, metrics, audit trail<br/>not present] --> WORKER
    OBS --> ALERTS
    OBS --> API_V2
```

## 5. Deployment topology

```mermaid
flowchart LR
    USER[API client] -->|HTTPS| RENDER[Render web service]
    RENDER --> GUNICORN[Gunicorn]
    GUNICORN --> FLASK[Flask app]
    FLASK --> MODEL[(Local model files)]
    FLASK --> THINGSPEAK[ThingSpeak APIs]
    FLASK --> OVERPASS[Overpass API]
    FLASK --> GMAIL[Gmail SMTP]
    CONFIG[Render environment variables] --> FLASK
```

The deployment graph reflects `render.yaml`; whether the service is currently
deployed and healthy cannot be established from this folder alone.
