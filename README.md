# LOOMCARE V1 Prototype

A household-first care prototype: a family/customer web app and phone app, an invisible parent-phone gateway, a browser gateway with a virtual pendant, a care-team management dashboard, and firmware for the finalized XIAO nRF54L15 + BMI270 pendant (plus an ESP32 software-testing rig).

**Status: implemented for supervised prototyping, not a medically validated or production-ready safety product.** The archived claims below describe the previous project and do not describe this V1 implementation.

## Product and build documentation

- [`docs/product/ux-guide.md`](docs/product/ux-guide.md) — approved Consumer App and System Dashboard UX language and information architecture.
- [`docs/product/requirements.md`](docs/product/requirements.md) — prioritized, testable product requirements.
- [`docs/product/gap-analysis.md`](docs/product/gap-analysis.md) — current capability versus the target experience.
- [`docs/product/implementation-plan.md`](docs/product/implementation-plan.md) — staged delivery plan and acceptance gates.
- [`hardware/README.md`](hardware/README.md) — current XIAO nRF54L15 + BMI270 assembly and validation handbook.

## Start here

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:8000`. Create a family account, add a parent with a virtual pendant, and click **Connect pendant**. Open the generated gateway in another tab. Test check-ins, fall cancellation, SOS, reminders, internet loss/replay, and low battery without hardware or external accounts.

For your team, provision a separate operator account; the command prompts for a password:

```bash
flask --app app create-operator --email team@example.com
```

Use another browser/profile for simultaneous family and team sessions. No default operator credentials are shipped.

| Interface | Path | Purpose |
| --- | --- | --- |
| Family/customer app | `/family` | Parent profiles, reminders, contacts (email + phone), check-ins, incidents, Care Circle roles and invites, gateways and silence-alert settings |
| Parent gateway | `/gateway` | Foreground Web Bluetooth bridge or hardware-free simulator |
| Locket Lab | `/simulator` | Real gateway-backed scenario lab showing locket, family-app and operations reactions |
| Phone app | `mobile/` | Expo/React Native: family mode (alerts via push, check-ins, reminders, Care Circle, QR pairing) and invisible parent-phone gateway mode (native BLE, Android foreground service, offline replay) |
| Team dashboard | `/team` | Customers and household detail, fleet and gateway health, incidents, inventory, support notes, delivery channels, team roles, audit and API timings |
| Developer hardware guide | `/hardware` (direct URL only) | Internal engineering reference: finalized prototype BOM (plain XIAO nRF54L15 + BMI270, ≤ ₹3,000), production cost target (≤ ₹2,000), block diagram, power budget, connectivity strategy, build path; ESP32 rig in a collapsible section. It is intentionally excluded from family and team navigation. |
| Product diagrams | `/static/architecture.svg`, `/static/connectivity.svg` | Pendant block diagram and connectivity/fallback architecture |
| Rollout plan | `/plan` | Consumer/native app refinement, operational work and pilot acceptance gates |
| Circuit diagram | `/static/circuit.svg` | Pin-level ESP32 software-testing rig (not the product hardware) |
| Health check | `/healthz` | Database access and workflow heartbeat |

## Architecture and limits

- Flask + SQLite WAL + static ES-module browser apps; no frontend build required. Existing databases migrate in place on startup.
- The database is intentionally simple: one private SQLite file at `data/care.db` locally or `/var/data/care.db` on Render. Database files are ignored by Git and must never be committed.
- On-pendant accel-first fall detection (shared C++ detector), 15-second cancellation, 2-second SOS, eight stored IST reminders, check-ins, and a persistent 32-event queue. XIAO firmware lets two gateways connect at once.
- Multi-gateway: each pendant can have up to four gateways (browser, parent’s phone, Home Hub), each with its own revocable credential and health. Duplicate relays create one incident.
- Tiered silence supervision: the team sees silence at once; the family is alerted after a per-parent window (2 min–24 h, default 15 min).
- Care Circle roles (owner / caregiver / viewer) with single-use 7-day invite codes. Team roles (admin / support), device inventory, support notes.
- Mobile bearer-token auth alongside CSRF-protected web sessions. Delivery channels: in-app inbox, optional SMTP, optional Expo push, optional HMAC-signed escalation webhook for SMS/voice providers (falls and SOS only). All retries bounded; tests never contact real providers.
- One Gunicorn worker with eight threads and persistent storage. Dockerfile and a paid-disk Render blueprint are supplied; no deployment has been performed automatically.
- The browser gateway must stay open; the phone app’s background relay needs a development/EAS build and on-device testing (see runbook). iOS may pause background relaying; a Home Hub is the dependable home option.
- Battery sensing is an approximate voltage measurement; charging telemetry denotes external USB power. Water resistance, comfort, battery life, BLE interoperability, and fall accuracy need physical testing.
- The old 95 MB Random Forest and ThingSpeak polling are **not** part of V1 startup or alert processing. Old training/data assets remain for research only.

See [the runbook](context/runbook.md) for deployment, environment variables, tests, and firmware builds. The interactive hardware and rollout guides contain the bill of materials, circuit and next delivery gates.

## Verification

```bash
python -m unittest discover -s tests -v
python tests/benchmark.py
npm ci
npx playwright install chromium
npm run test:e2e
cd mobile && npm ci && npx tsc --noEmit && npx expo lint
west build -b xiao_nrf54l15/nrf54l15/cpuapp hardware_code/pendant_nrf54
```

Browser tests run against an isolated temporary database on port 8011. If using an installed Chrome instead of a downloaded browser, run `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`. See the runbook for the native C++ detector test. Local API benchmarks exclude BLE, networks, SMTP and human response.

---

## Archived pre-V1 project description

The following material is retained as historical context only. Its completion badges, Flutter/Gen-AI claims, installation examples and legacy API descriptions are not current V1 documentation.

[![Project Status](https://img.shields.io/badge/Status-100%25%20Complete-brightgreen)]()
[![Hardware](https://img.shields.io/badge/Hardware-ESP8266-blue)]()
[![ML Model](https://img.shields.io/badge/ML-Python-green)]()
[![Mobile](https://img.shields.io/badge/Mobile-Flutter-cyan)]()
[![Cloud](https://img.shields.io/badge/Cloud-Render-purple)]()

## 🚀 Project Overview

An intelligent IoT-based healthcare monitoring system that combines wearable sensors, machine learning, and mobile technology to detect falls in real-time and provide immediate emergency alerts. This comprehensive solution is designed to enhance safety for elderly individuals and people at risk of falls.

> **Repository map:** See [`context/README.md`](context/README.md) for the
> implementation-aware architecture graphs, codebase map, runbook, and execution
> plan. It distinguishes code present in this snapshot from the broader product
> described below.

## 📋 Table of Contents

- [Features](#features)
- [System Architecture](#system-architecture)
- [Components](#components)
- [Project Status](#project-status)
- [Technologies Used](#technologies-used)
- [Installation](#installation)
- [Usage](#usage)
- [API Documentation](#api-documentation)
- [Contributing](#contributing)
- [Future Enhancements](#future-enhancements)
- [License](#license)

## ✨ Features

- **Real-time Health Monitoring**: Continuous tracking of heart rate, body temperature, and motion
- **AI-Powered Fall Detection**: Machine learning model trained on 370,000+ data points
- **GPS Location Tracking**: Precise location identification for emergency response
- **Automated Alert System**: Instant email notifications to emergency contacts
- **Nearby Hospital Locator**: Location-based identification of nearby healthcare facilities
- **Health Data Translation**: Gen AI-powered interpretation of health metrics
- **Mobile Dashboard**: Flutter-based mobile application for real-time monitoring
- **Cloud Integration**: Scalable cloud infrastructure for data processing

## 🏗️ System Architecture

```
┌─────────────────┐    ┌──────────────┐    ┌─────────────────┐
│   Wrist Band    │────│  ThingSpeak  │────│  Cloud Backend  │
│   (Sensors)     │    │   Platform   │    │   (ML + Alerts) │
└─────────────────┘    └──────────────┘    └─────────────────┘
         │                                            │
         │              ┌──────────────┐              │
         └──────────────│ Flutter App  │──────────────┘
                        │   (Mobile)   │
                        └──────────────┘
```

## 🔧 Components

### 1. **Hardware Wrist Band** ✅ *Completed*

**Sensors Integrated:**
- **MAX30100**: Heart rate and SpO2 sensor
- **DS18B20**: Digital temperature sensor
- **MPU6050**: 6-axis accelerometer and gyroscope
- **Neo 6M GPS**: Location tracking module
- **NodeMCU (ESP8266)**: Main microcontroller

**Data Pipeline:**
- Real-time sensor data collection
- WiFi connectivity for data transmission
- Integration with ThingSpeak IoT platform

### 2. **ML Fall Detection Model** ✅ *Completed*

**Model Specifications:**
- **Dataset Size**: 370,000+ data points
- **Classes**: Fall vs Non-Fall detection
- **Output Files**: `model.pkl` and `scaler.pkl`
- **Accuracy**: High precision binary classification
- **Integration**: Real-time processing of ThingSpeak data

### 3. **Location-Based Alert System** ✅ *Completed*

**Features:**
- GPS coordinate processing
- Nearby hospital and healthcare center identification
- SMTP email alert system via Gmail
- Emergency contact notification
- Location-aware response system

### 4. **Gen AI Health Translation** ✅ *Completed*

**Features:**
- Advanced Gen AI integration for health data interpretation
- Health data translation and analysis
- BMI calculation and health insights
- User-friendly health metric explanations
- Personalized health recommendations
- Real-time health status assessment

### 5. **Cloud Infrastructure** ✅ *Completed*

**Deployment Details:**
- **Platform**: Render cloud deployment
- **Services**: ML model hosting, alert system backend
- **API Endpoints**: Real-time data processing
- **Data Source**: Live ThingSpeak integration
- **Scalability**: Auto-scaling cloud architecture

### 6. **Flutter Mobile Application** ✅ *Completed*

**Features:**
- User registration and profile management
- Real-time health dashboard
- Live sensor data visualization
- Fall detection status monitoring
- Heart rate charts and trends
- Gen AI health translations display
- Emergency contact management
- Intuitive user interface with real-time updates

## 📊 Project Status

| Component | Status | Progress |
|-----------|--------|----------|
| Hardware Wrist Band | ✅ Complete | 100% |
| ML Fall Detection | ✅ Complete | 100% |
| Alert System | ✅ Complete | 100% |
| Cloud Infrastructure | ✅ Complete | 100% |
| Gen AI Integration | ✅ Complete | 100% |
| Flutter Mobile App | ✅ Complete | 100% |

**Overall Progress: 100% Complete (6/6 modules)**

## 🛠️ Technologies Used

### Hardware
- ESP8266 (NodeMCU)
- MAX30100 Heart Rate Sensor
- DS18B20 Temperature Sensor
- MPU6050 Accelerometer/Gyroscope
- Neo 6M GPS Module

### Software & Platforms
- **Programming Languages**: Python, C++ (Arduino), Dart (Flutter)
- **IoT Platform**: ThingSpeak
- **Machine Learning**: Python (Scikit-learn/TensorFlow)
- **Cloud Platform**: Render
- **Mobile Framework**: Flutter
- **AI Integration**: Gen AI API
- **Communication**: SMTP Gmail API
- **Data Format**: JSON, CSV

## 🚀 Installation

### Prerequisites
- Python 3.8+
- Arduino IDE
- Flutter SDK
- ThingSpeak account
- Gmail account for SMTP
- Render account for cloud deployment

### Hardware Setup
1. Connect all sensors to NodeMCU according to the wiring diagram
2. Flash the Arduino code to NodeMCU
3. Configure WiFi credentials and ThingSpeak API keys
4. Assemble components into wristband housing

### Software Setup
```bash
# Clone the repository
git clone https://github.com/Kunal70616c/Fall-Detection-and-Alert-System-Using-Body-Area-Network.git
cd Fall-Detection-and-Alert-System-Using-Body-Area-Network

# Install Python dependencies
pip install -r requirements.txt

# Configure environment variables
cp .env.example .env
# Edit .env with your API keys and credentials
```

### Cloud Deployment
1. Deploy ML model and alert system to Render
2. Configure ThingSpeak channel integration
3. Set up SMTP email credentials
4. Test API endpoints

### Mobile App Setup
```bash
# Navigate to Flutter app directory
cd flutter_app

# Install dependencies
flutter pub get

# Run the app
flutter run
```

## 📱 Usage

### For End Users
1. **Setup**: Wear the wristband and ensure proper sensor contact
2. **Mobile App**: Download and install the Flutter mobile application
3. **Registration**: Create user profile and add emergency contacts
4. **Monitoring**: Real-time health data is automatically collected and displayed
5. **Fall Detection**: System automatically detects falls and sends alerts
6. **Health Insights**: View Gen AI-powered health translations and recommendations

### For Developers
```python
# Example: Using the ML model
from fall_detection import FallDetectionModel

model = FallDetectionModel()
prediction = model.predict(sensor_data)
print(f"Fall Detected: {prediction}")
```

## 📡 API Documentation

### Endpoints


#### Fall Detection Endpoint
```
POST /api/fall-detection
Body: Sensor data array (accelerometer, heart rate, temperature)
```

**Response Format:**
```json
// When fall is detected
{
    "status": "success",
    "fall_detected": true,
    "location": {
        "latitude": 22.5726,
        "longitude": 88.3639
    }
}

// When no fall is detected
{
    "status": "success",
    "fall_detected": false
}
```

#### Alert System Endpoint
```
POST /api/send-alert
Body: Location and user data
Returns: Alert status and nearby hospitals
```

#### Gen AI Health Translation Endpoint
```
POST /api/health-translation
Body: Health metrics and user data
Returns: AI-powered health insights and recommendations
```

## 🤝 Contributing

We welcome contributions to improve this fall detection system!

### How to Contribute
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Areas for Enhancement
- [ ] Advanced sensor integration
- [ ] Enhanced Gen AI capabilities
- [ ] Performance optimizations
- [ ] Additional mobile app features
- [ ] Testing and validation improvements
- [ ] Documentation enhancements

## 🔮 Future Enhancements

### Immediate Improvements
- [ ] Enhanced Gen AI health prediction models
- [ ] Advanced mobile app analytics
- [ ] Multi-language support
- [ ] Improved user interface design

### Long-term Vision
- [ ] Multi-user family monitoring dashboard
- [ ] Integration with hospital emergency systems
- [ ] Advanced predictive health analytics
- [ ] Wearable device miniaturization
- [ ] Voice assistant integration
- [ ] Telemedicine platform integration

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👨‍💻 Authors

**Kunal Pal** - [Kunal70616c](https://github.com/Kunal70616c)

**Indranil Kundu** - [Orton1269](https://github.com/Orton1269)

## 🙏 Acknowledgments

- ThingSpeak for IoT platform services
- Gen AI for health data interpretation
- Open source sensor libraries and communities
- Contributors and testers
- Flutter community for mobile development support

## 📞 Support

For support, email kunal.cs.dev@outlook.com or create an issue in this repository.

---

⭐ **Star this repository if you found it helpful!**

**Made with ❤️ for safer living**
