#include <Arduino.h>
#include <Wire.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <BLESecurity.h>
#include <esp_gap_ble_api.h>
#include <sys/time.h>
#include "fall_detector.h"

#ifndef POWER_SENSE
#define POWER_SENSE 0
#endif

constexpr uint8_t BUTTON = 27, MOTOR = 25, BUZZER = 26, LED = 2, BATTERY = 34, USB_SENSE = 35;
constexpr uint8_t IMU = 0x69, RTC = 0x68;
constexpr char SERVICE[] = "8be12000-7e34-4b80-8fd8-7277a721e9bc";
constexpr char TX_UUID[] = "8be12001-7e34-4b80-8fd8-7277a721e9bc";
constexpr char RX_UUID[] = "8be12002-7e34-4b80-8fd8-7277a721e9bc";
constexpr int OFFSET = 19800;
struct StoredEvent { char id[22], kind[20], ref[64]; uint32_t at; };
struct Reminder { char id[33]; uint16_t minute; bool enabled; uint32_t firedDay; };
struct Prompt { char ref[64]; uint32_t expires; bool checkin; };
struct State {
    uint32_t magic, nextId, overflow;
    uint8_t count, reminderCount, promptCount;
    StoredEvent queue[32];
    Reminder reminders[8];
    Prompt prompts[9];
    char lastCommand[33];
    bool fallPending;
    uint32_t fallDeadline;
} state;
struct Frame { char text[192]; };
Preferences prefs;
QueueHandle_t rxQueue, txQueue;
BLECharacteristic *txCharacteristic;
BLEServer *bleServer;
volatile bool secureConnected = false, restartAdvertising = false;
uint32_t passkey, lastSample = 0, warningStarted = 0, lastStatus = 0, lastEvent = 0, lastRtc = 0;
bool sensorOK = false, clockOK = false, warningActive = false;
FallDetector detector;
Reminder staging[8];
uint8_t stagingCount = 0, expectedCount = 0;
bool stagingValid = false;
char stagingVersion[20];

void save() { prefs.putBytes("state", &state, sizeof(state)); }
uint32_t epoch() { const time_t t = time(nullptr); return clockOK && t > 1704067200 ? uint32_t(t) : 0; }
bool readRegisters(uint8_t address, uint8_t reg, uint8_t *bytes, size_t length) {
    Wire.beginTransmission(address); Wire.write(reg);
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(address, uint8_t(length)) != length) return false;
    for (size_t i = 0; i < length; ++i) bytes[i] = Wire.read();
    return true;
}
bool writeRegister(uint8_t address, uint8_t reg, uint8_t value) {
    Wire.beginTransmission(address); Wire.write(reg); Wire.write(value);
    return Wire.endTransmission() == 0;
}
uint8_t bcd(uint8_t value) { return (value / 10) * 16 + value % 10; }
uint8_t unbcd(uint8_t value) { return (value >> 4) * 10 + (value & 15); }
bool restoreClock() {
    uint8_t values[7], status;
    if (!readRegisters(RTC, 0x0F, &status, 1) || (status & 0x80) || !readRegisters(RTC, 0, values, 7)) return false;
    tm t = {};
    t.tm_sec = unbcd(values[0] & 0x7F); t.tm_min = unbcd(values[1] & 0x7F);
    t.tm_hour = unbcd(values[2] & 0x3F); t.tm_mday = unbcd(values[4] & 0x3F);
    t.tm_mon = unbcd(values[5] & 0x1F) - 1; t.tm_year = 100 + unbcd(values[6]);
    if (t.tm_year < 124 || t.tm_year > 199 || t.tm_mon < 0 || t.tm_mon > 11 || t.tm_mday < 1 || t.tm_mday > 31 || t.tm_hour > 23 || t.tm_min > 59 || t.tm_sec > 59) return false;
    timeval tv = {mktime(&t), 0}; settimeofday(&tv, nullptr); return true;
}
bool setClock(uint32_t value) {
    if (value < 1704067200 || value > 4102444799UL) return false;
    time_t raw = value; tm t; gmtime_r(&raw, &t);
    Wire.beginTransmission(RTC); Wire.write(0);
    uint8_t fields[] = {bcd(t.tm_sec), bcd(t.tm_min), bcd(t.tm_hour), bcd(t.tm_wday + 1), bcd(t.tm_mday), bcd(t.tm_mon + 1), bcd(t.tm_year - 100)};
    Wire.write(fields, sizeof(fields));
    if (Wire.endTransmission() != 0) return false;
    uint8_t status;
    if (!readRegisters(RTC, 0x0F, &status, 1) || !writeRegister(RTC, 0x0F, status & ~0x80)) return false;
    timeval tv = {time_t(value), 0}; settimeofday(&tv, nullptr); return true;
}
void queueFrame(const JsonDocument &doc) {
    if (!secureConnected) return;
    Frame frame = {};
    const size_t size = serializeJson(doc, frame.text, sizeof(frame.text) - 2);
    if (size >= sizeof(frame.text) - 2) return;
    frame.text[size] = '\n'; frame.text[size + 1] = 0;
    xQueueSend(txQueue, &frame, 0);
}
void receipt(const char *kind, const char *ref) {
    StaticJsonDocument<160> doc; doc["kind"] = kind; doc["ref"] = ref; queueFrame(doc);
}
bool emit(const char *kind, const char *ref = "") {
    static bool overflowNoted = false;
    if (state.count >= 32) { if (!overflowNoted) { state.overflow++; save(); overflowNoted = true; } return false; }
    overflowNoted = false;
    StoredEvent &event = state.queue[state.count++];
    snprintf(event.id, sizeof(event.id), "%lu", static_cast<unsigned long>(state.nextId++));
    strlcpy(event.kind, kind, sizeof(event.kind)); strlcpy(event.ref, ref, sizeof(event.ref)); event.at = epoch();
    save(); lastEvent = millis() - 3000; return true;
}
void processCommand(const char *input) {
    StaticJsonDocument<384> doc;
    if (deserializeJson(doc, input)) return;
    const char *op = doc["op"] | "";
    if (!strcmp(op, "ack")) {
        const char *id = doc["id"] | "";
        if (state.count && !strcmp(state.queue[0].id, id)) {
            memmove(state.queue, state.queue + 1, (--state.count) * sizeof(StoredEvent)); save(); lastEvent = millis() - 3000;
        }
    } else if (!strcmp(op, "time")) {
        clockOK = setClock(doc["epoch"] | 0UL);
    } else if (!strcmp(op, "begin")) {
        const int count = doc["count"] | -1;
        const char *version = doc["version"] | "";
        stagingValid = count >= 0 && count <= 8 && strlen(version) < sizeof(stagingVersion);
        expectedCount = count; stagingCount = 0; strlcpy(stagingVersion, version, sizeof(stagingVersion));
    } else if (!strcmp(op, "reminder")) {
        const char *id = doc["id"] | ""; const int minute = doc["minute"] | -1;
        if (!stagingValid || stagingCount >= expectedCount || strlen(id) != 32 || minute < 0 || minute > 1439 || !doc["enabled"].is<bool>()) { stagingValid = false; return; }
        for (int i = 0; i < stagingCount; ++i) if (!strcmp(staging[i].id, id)) { stagingValid = false; return; }
        Reminder &r = staging[stagingCount++]; memset(&r, 0, sizeof(r));
        strlcpy(r.id, id, sizeof(r.id)); r.minute = minute; r.enabled = doc["enabled"];
        for (int i = 0; i < state.reminderCount; ++i) if (!strcmp(state.reminders[i].id, id)) r.firedDay = state.reminders[i].firedDay;
    } else if (!strcmp(op, "commit")) {
        if (!stagingValid || stagingCount != expectedCount) return;
        memcpy(state.reminders, staging, stagingCount * sizeof(Reminder)); state.reminderCount = stagingCount;
        for (int i = 0; i < state.promptCount;) {
            bool keep = state.prompts[i].checkin;
            for (int j = 0; j < state.reminderCount; ++j) if (state.reminders[j].enabled && !strncmp(state.prompts[i].ref, state.reminders[j].id, 32)) keep = true;
            if (keep) i++;
            else { memmove(state.prompts + i, state.prompts + i + 1, (--state.promptCount - i) * sizeof(Prompt)); }
        }
        save(); stagingValid = false; receipt("config_received", stagingVersion);
    } else if (!strcmp(op, "checkin")) {
        const char *id = doc["id"] | "", *ref = doc["ref"] | ""; uint32_t expires = doc["expires"] | 0UL;
        if (strlen(id) != 32 || strlen(ref) != 32 || !epoch() || expires <= epoch() || expires > epoch() + 180) return;
        if (!strcmp(id, state.lastCommand)) { receipt("receipt", id); return; }
        if (state.promptCount >= 9) return;
        Prompt &prompt = state.prompts[state.promptCount++]; strlcpy(prompt.ref, ref, sizeof(prompt.ref)); prompt.expires = expires; prompt.checkin = true;
        strlcpy(state.lastCommand, id, sizeof(state.lastCommand)); save(); receipt("receipt", id);
    }
}
class InputCallbacks : public BLECharacteristicCallbacks {
    String input;
    bool discard = false;
    void onWrite(BLECharacteristic *characteristic) override {
        if (!secureConnected) return;
        const std::string value = characteristic->getValue();
        for (char c : value) {
            if (c == '\n') {
                if (!discard) { Frame frame = {}; strlcpy(frame.text, input.c_str(), sizeof(frame.text)); xQueueSend(rxQueue, &frame, 0); }
                input = ""; discard = false;
            } else if (input.length() < 190 && !discard) input += c;
            else { discard = true; input = ""; }
        }
    }
};
class ServerCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer *server, esp_ble_gatts_cb_param_t *param) override {
        secureConnected = false; esp_ble_set_encryption(param->connect.remote_bda, ESP_BLE_SEC_ENCRYPT_MITM);
    }
    void onDisconnect(BLEServer *server) override { secureConnected = false; restartAdvertising = true; }
};
class SecurityCallbacks : public BLESecurityCallbacks {
    uint32_t onPassKeyRequest() override { return passkey; }
    void onPassKeyNotify(uint32_t key) override {}
    bool onConfirmPIN(uint32_t key) override { return key == passkey; }
    bool onSecurityRequest() override { return true; }
    void onAuthenticationComplete(esp_ble_auth_cmpl_t result) override { secureConnected = result.success; }
};
void sampleMotion(uint32_t now) {
    uint8_t raw[14];
    if (!readRegisters(IMU, 0x3B, raw, sizeof(raw))) {
        if (sensorOK) emit("device_fault"); sensorOK = false; return;
    }
    if (!sensorOK) {
        sensorOK = writeRegister(IMU, 0x6B, 1) && writeRegister(IMU, 0x1A, 3) && writeRegister(IMU, 0x19, 19) && writeRegister(IMU, 0x1C, 0x10) && writeRegister(IMU, 0x1B, 0x08);
        return;
    }
    auto word = [&raw](uint8_t i) { return int16_t((uint16_t(raw[i]) << 8) | raw[i + 1]); };
    if (!warningActive && detector.update(word(0) / 4096.0f, word(2) / 4096.0f, word(4) / 4096.0f, word(8) / 65.5f, word(10) / 65.5f, word(12) / 65.5f, now)) {
        warningActive = true; warningStarted = now; state.fallPending = true; state.fallDeadline = epoch() ? epoch() + 15 : 0; save(); receipt("local_warning", "15");
    }
}
void buttonTick(uint32_t now) {
    static bool rawLast = false, down = false, held = false;
    static uint32_t changedAt = 0, downAt = 0;
    const bool raw = digitalRead(BUTTON) == LOW;
    if (raw != rawLast) { rawLast = raw; changedAt = now; }
    if (uint32_t(now - changedAt) >= 35 && down != raw) {
        down = raw;
        if (down) { downAt = now; held = false; }
        else if (!held) {
            if (warningActive) {
                if (emit("fall_cancelled")) { warningActive = false; state.fallPending = false; save(); }
            } else if (state.promptCount) {
                int index = 0;
                for (int i = 0; i < state.promptCount; ++i) if (state.prompts[i].checkin) { index = i; break; }
                Prompt &p = state.prompts[index];
                if (emit(p.checkin ? "checkin_ack" : "reminder_ack", p.ref)) {
                    memmove(state.prompts + index, state.prompts + index + 1, (state.promptCount - index - 1) * sizeof(Prompt)); state.promptCount--; save();
                }
            }
        }
    }
    if (down && !held && uint32_t(now - downAt) >= 2000) {
        held = true;
        if (emit("sos")) { warningActive = false; state.fallPending = false; save(); }
    }
}
void reminderTick() {
    const uint32_t current = epoch(); if (!current) return;
    const uint32_t day = (current + OFFSET) / 86400;
    bool changed = false;
    for (int i = 0; i < state.promptCount;) {
        if (state.prompts[i].expires <= current) { memmove(state.prompts + i, state.prompts + i + 1, (--state.promptCount - i) * sizeof(Prompt)); changed = true; }
        else i++;
    }
    for (int i = 0; i < state.reminderCount; ++i) {
        Reminder &r = state.reminders[i]; const uint32_t due = day * 86400 - OFFSET + r.minute * 60;
        if (r.enabled && r.firedDay != day && current >= due && current < due + 300 && state.promptCount < 9) {
            Prompt &p = state.prompts[state.promptCount++]; snprintf(p.ref, sizeof(p.ref), "%s:%lu", r.id, static_cast<unsigned long>(day)); p.checkin = false; p.expires = due + 300;
            r.firedDay = day; changed = true;
        }
    }
    if (changed) save();
}
void telemetry() {
    StaticJsonDocument<384> doc;
    doc["kind"] = "status"; doc["firmware"] = "esp32/1.0"; doc["sensor_ok"] = sensorOK; doc["clock_ok"] = clockOK; doc["queue_overflow"] = state.overflow;
    if (POWER_SENSE) {
        float mv = 0, usb = 0;
        for (int i = 0; i < 8; ++i) { mv += analogReadMilliVolts(BATTERY); usb += analogReadMilliVolts(USB_SENSE); }
        const float voltage = mv / 8.0f * 2.0f / 1000.0f;
        if (voltage > 2.8f && voltage < 4.4f) doc["battery"] = int(constrain((voltage - 3.3f) / .9f * 100.0f, 0.0f, 100.0f));
        else doc["battery"] = nullptr;
        doc["charging"] = usb / 8.0f * 2.0f > 4200;
    } else { doc["battery"] = nullptr; doc["charging"] = nullptr; }
    queueFrame(doc);
}
void transmitTick(uint32_t now) {
    static Frame frame = {}; static size_t offset = 0; static uint32_t sentAt = 0;
    if (!secureConnected) { offset = 0; frame.text[0] = 0; xQueueReset(txQueue); return; }
    if (!frame.text[0] && xQueueReceive(txQueue, &frame, 0) != pdTRUE) return;
    if (uint32_t(now - sentAt) < 12) return;
    sentAt = now;
    const size_t length = strlen(frame.text), count = min(size_t(20), length - offset);
    txCharacteristic->setValue(reinterpret_cast<uint8_t *>(frame.text + offset), count); txCharacteristic->notify(); offset += count;
    if (offset >= length) { frame.text[0] = 0; offset = 0; }
}
void setup() {
    Serial.begin(115200);
    pinMode(BUTTON, INPUT_PULLUP); pinMode(MOTOR, OUTPUT); pinMode(BUZZER, OUTPUT); pinMode(LED, OUTPUT);
    digitalWrite(MOTOR, LOW); digitalWrite(BUZZER, LOW); digitalWrite(LED, LOW);
    Wire.begin(21, 22); Wire.setClock(400000); Wire.setTimeOut(20);
    setenv("TZ", "UTC0", 1); tzset();
    prefs.begin("loomcare", false);
    if (prefs.getBytesLength("state") == sizeof(state)) prefs.getBytes("state", &state, sizeof(state));
    if (state.magic != 0x4C434131 || state.count > 32 || state.reminderCount > 8 || state.promptCount > 9) { memset(&state, 0, sizeof(state)); state.magic = 0x4C434131; state.nextId = 1; save(); }
    clockOK = restoreClock();
    uint8_t who;
    sensorOK = readRegisters(IMU, 0x75, &who, 1) && (who & 0x7E) == 0x68 && writeRegister(IMU, 0x6B, 1) && writeRegister(IMU, 0x1A, 3) && writeRegister(IMU, 0x19, 19) && writeRegister(IMU, 0x1C, 0x10) && writeRegister(IMU, 0x1B, 0x08);
    if (!sensorOK) emit("device_fault");
    if (state.fallPending) {
        warningActive = true; warningStarted = millis();
        if (epoch() && state.fallDeadline && epoch() >= state.fallDeadline && emit("fall")) { warningActive = false; state.fallPending = false; save(); }
    }
    passkey = prefs.getUInt("ble_pin", 0);
    if (passkey < 100000 || passkey > 999999) {
        passkey = 0;
        Serial.println("Setup required: enter a private 6-digit BLE PIN (100000-999999), then Enter. Input is not echoed. Monitoring starts after setup.");
        char pinInput[7] = {}; uint8_t length = 0; bool invalid = false;
        while (!passkey) {
            if (Serial.available()) {
                const char c = Serial.read();
                if (c == '\r' || c == '\n') {
                    if (!invalid && length == 6) {
                        const uint32_t candidate = strtoul(pinInput, nullptr, 10);
                        if (candidate >= 100000 && candidate <= 999999 && prefs.putUInt("ble_pin", candidate) == sizeof(uint32_t)) passkey = candidate;
                    }
                    if (!passkey && length) Serial.println("PIN not saved; retry six digits. Do not share this PIN.");
                    memset(pinInput, 0, sizeof(pinInput)); length = 0; invalid = false;
                } else if (c >= '0' && c <= '9' && length < 6) pinInput[length++] = c;
                else invalid = true;
            }
            delay(10);
        }
        Serial.println("BLE provisioning complete. The PIN will not be displayed or logged.");
    }
    Serial.printf("Motion sensor: %s; RTC: %s\n", sensorOK ? "ready" : "FAULT", clockOK ? "ready" : "sync needed");
    rxQueue = xQueueCreate(16, sizeof(Frame)); txQueue = xQueueCreate(8, sizeof(Frame));
    BLEDevice::init("LOOMCARE Pendant"); BLEDevice::setEncryptionLevel(ESP_BLE_SEC_ENCRYPT_MITM); BLEDevice::setSecurityCallbacks(new SecurityCallbacks());
    BLESecurity *security = new BLESecurity(); security->setAuthenticationMode(ESP_LE_AUTH_REQ_SC_MITM_BOND); security->setCapability(ESP_IO_CAP_OUT); security->setKeySize(16); security->setStaticPIN(passkey);
    security->setInitEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK); security->setRespEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);
    bleServer = BLEDevice::createServer(); bleServer->setCallbacks(new ServerCallbacks());
    BLEService *service = bleServer->createService(SERVICE);
    txCharacteristic = service->createCharacteristic(TX_UUID, BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_READ);
    txCharacteristic->setAccessPermissions(ESP_GATT_PERM_READ_ENC_MITM);
    BLE2902 *descriptor = new BLE2902(); descriptor->setAccessPermissions(ESP_GATT_PERM_READ_ENCRYPTED | ESP_GATT_PERM_WRITE_ENCRYPTED); txCharacteristic->addDescriptor(descriptor);
    BLECharacteristic *input = service->createCharacteristic(RX_UUID, BLECharacteristic::PROPERTY_WRITE);
    input->setAccessPermissions(ESP_GATT_PERM_WRITE_ENC_MITM); input->setCallbacks(new InputCallbacks()); service->start();
    BLEAdvertising *advertising = BLEDevice::getAdvertising(); advertising->addServiceUUID(SERVICE); advertising->setScanResponse(true); advertising->start();
    if (POWER_SENSE) { analogSetPinAttenuation(BATTERY, ADC_11db); analogSetPinAttenuation(USB_SENSE, ADC_11db); }
}
void loop() {
    const uint32_t now = millis();
    Frame input;
    if (xQueueReceive(rxQueue, &input, 0) == pdTRUE) processCommand(input.text);
    if (restartAdvertising) { restartAdvertising = false; BLEDevice::startAdvertising(); }
    if (uint32_t(now - lastSample) >= 20) { lastSample = now; sampleMotion(now); }
    buttonTick(now);
    if (warningActive && uint32_t(now - warningStarted) >= 15000 && emit("fall")) { warningActive = false; state.fallPending = false; save(); }
    static uint32_t reminderAt = 0;
    if (uint32_t(now - reminderAt) >= 1000) { reminderAt = now; reminderTick(); }
    if (uint32_t(now - lastRtc) >= 60000) { lastRtc = now; clockOK = restoreClock(); }
    if (uint32_t(now - lastStatus) >= 10000) { lastStatus = now; telemetry(); }
    if (secureConnected && state.count && uint32_t(now - lastEvent) >= 3000) {
        lastEvent = now; const StoredEvent &event = state.queue[0]; StaticJsonDocument<256> doc;
        doc["id"] = event.id; doc["kind"] = event.kind; doc["at"] = event.at;
        if (event.ref[0]) doc["ref"] = event.ref;
        queueFrame(doc);
    }
    const bool prompt = warningActive || state.promptCount > 0;
    const bool pulse = prompt && (now % (warningActive ? 800 : 2000)) < 250;
    digitalWrite(MOTOR, pulse); digitalWrite(BUZZER, pulse);
    digitalWrite(LED, !sensorOK || !clockOK || state.overflow ? (now % 300 < 150) : secureConnected ? (now % 4000 < 60) : (now % 1000 < 60));
    transmitTick(now); delay(2);
}
