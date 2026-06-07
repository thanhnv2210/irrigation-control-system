/**
 * irrigation_main.ino
 * Smart Irrigation Controller — ESP32
 *
 * Zones: balcony (zone 1), garden (zone 2)
 * Firebase RTDB path: /irrigation/zones/{zone_id}/
 *
 * Build requirements:
 *   - FirebaseESP32 by mobizt (Arduino Library Manager)
 *   - Copy config.h.example to config.h and fill in credentials
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <FirebaseESP32.h>
#include <addons/TokenHelper.h>
#include <addons/RTDBHelper.h>

#include "config.h"

// ---------------------------------------------------------------------------
// WiFi provisioning (captive portal pattern from esp_32_auto_config_v1)
// ---------------------------------------------------------------------------
static const char* AP_SSID     = "ESP32_Config";
static const char* AP_PASSWORD = "123456789";

WebServer server(80);
Preferences preferences;

static String wifiSSID;
static String wifiPassword;
static bool   inAPMode = false;

static const char* PROV_HTML = R"rawliteral(
<!DOCTYPE html><html><head><title>Irrigation — WiFi Setup</title></head><body>
<h2>Configure WiFi</h2>
<form action="/save" method="post">
  SSID:<br><input type="text" name="ssid"><br><br>
  Password:<br><input type="password" name="pass"><br><br>
  <input type="submit" value="Save & Reboot">
</form></body></html>
)rawliteral";

void handleProvRoot() { server.send(200, "text/html", PROV_HTML); }

void handleProvSave() {
  if (server.hasArg("ssid") && server.hasArg("pass")) {
    preferences.begin("wifi", false);
    preferences.putString("ssid", server.arg("ssid"));
    preferences.putString("pass", server.arg("pass"));
    preferences.end();
    server.send(200, "text/html", "<h3>Saved. Rebooting...</h3>");
    delay(1500);
    ESP.restart();
  } else {
    server.send(400, "text/plain", "Missing parameters");
  }
}

// ---------------------------------------------------------------------------
// Firebase objects
// ---------------------------------------------------------------------------
FirebaseData fbdo;         // General get/set
FirebaseData streamZ1;     // Stream for zone 1 command
FirebaseData streamZ2;     // Stream for zone 2 command
FirebaseAuth fbAuth;
FirebaseConfig fbConfig;

// ---------------------------------------------------------------------------
// Zone state
// ---------------------------------------------------------------------------
struct Zone {
  const char* id;
  uint8_t     sensorPin;
  uint8_t     relayPin;
  int         dryRaw;
  int         wetRaw;

  bool     valveOpen;
  uint32_t valveOpenedAt;  // millis() when valve was opened
};

Zone zones[2] = {
  { ZONE_1_ID, SENSOR_1_PIN, RELAY_1_PIN, DRY_RAW_1, WET_RAW_1, false, 0 },
  { ZONE_2_ID, SENSOR_2_PIN, RELAY_2_PIN, DRY_RAW_2, WET_RAW_2, false, 0 },
};

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------
static uint32_t lastSensorMs    = 0;
static uint32_t lastHeartbeatMs = 0;
static uint32_t lastFirebaseOkMs = 0;  // tracks last successful Firebase call

// ---------------------------------------------------------------------------
// Relay control
// ---------------------------------------------------------------------------
void openValve(int zoneIdx, const char* openedBy) {
  Zone& z = zones[zoneIdx];
  if (z.valveOpen) return;

  digitalWrite(z.relayPin, LOW);  // Active-LOW relay
  z.valveOpen    = true;
  z.valveOpenedAt = millis();

  String basePath = String("/irrigation/zones/") + z.id;
  Firebase.setString(fbdo, basePath + "/valve/state",       "OPEN");
  Firebase.setString(fbdo, basePath + "/valve/openedBy",    openedBy);
  Firebase.setInt   (fbdo, basePath + "/valve/lastChangedAt", (int)millis());

  Serial.printf("[Zone %s] Valve OPEN (by %s)\n", z.id, openedBy);
}

void closeValve(int zoneIdx) {
  Zone& z = zones[zoneIdx];
  if (!z.valveOpen) return;

  digitalWrite(z.relayPin, HIGH);  // Active-LOW relay — HIGH = off
  z.valveOpen = false;

  String basePath = String("/irrigation/zones/") + z.id;
  Firebase.setString(fbdo, basePath + "/valve/state",         "CLOSED");
  Firebase.setInt   (fbdo, basePath + "/valve/lastChangedAt", (int)millis());

  Serial.printf("[Zone %s] Valve CLOSED\n", z.id);
}

// ---------------------------------------------------------------------------
// Safety: force-close any valve open longer than MAX_VALVE_MS
// ---------------------------------------------------------------------------
void enforceValveSafety() {
  for (int i = 0; i < 2; i++) {
    if (zones[i].valveOpen) {
      uint32_t openMs = millis() - zones[i].valveOpenedAt;
      if (openMs >= MAX_VALVE_MS) {
        Serial.printf("[Zone %s] SAFETY: max open time reached, closing valve\n", zones[i].id);
        closeValve(i);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Sensors
// ---------------------------------------------------------------------------
int readMoisturePercent(const Zone& z) {
  int raw = analogRead(z.sensorPin);
  int pct = map(raw, z.dryRaw, z.wetRaw, 0, 100);
  return constrain(pct, 0, 100);
}

void readAndPublishSensors() {
  for (int i = 0; i < 2; i++) {
    Zone& z = zones[i];
    int raw = analogRead(z.sensorPin);
    int pct = constrain(map(raw, z.dryRaw, z.wetRaw, 0, 100), 0, 100);

    String basePath = String("/irrigation/zones/") + z.id + "/sensor";

    FirebaseJson json;
    json.set("moisturePercent", pct);
    json.set("rawValue",        raw);
    json.set("timestamp/.sv",   "timestamp");  // server timestamp

    if (Firebase.updateNode(fbdo, basePath, json)) {
      lastFirebaseOkMs = millis();
      Serial.printf("[Zone %s] Moisture: %d%% (raw %d)\n", z.id, pct, raw);
    } else {
      Serial.printf("[Zone %s] Sensor publish failed: %s\n", z.id, fbdo.errorReason().c_str());
    }
  }
}

// ---------------------------------------------------------------------------
// Device heartbeat
// ---------------------------------------------------------------------------
void publishHeartbeat() {
  String basePath = String("/irrigation/devices/") + DEVICE_ID;

  FirebaseJson json;
  json.set("firmware",       FIRMWARE_VERSION);
  json.set("lastSeen/.sv",   "timestamp");
  json.set("ipAddress",      WiFi.localIP().toString());
  json.set("wifiRssi",       WiFi.RSSI());

  if (Firebase.updateNode(fbdo, basePath, json)) {
    lastFirebaseOkMs = millis();
  }
}

// ---------------------------------------------------------------------------
// Command handler (called from stream callbacks)
// ---------------------------------------------------------------------------
void handleCommand(int zoneIdx, const String& action) {
  String clearPath = String("/irrigation/zones/") + zones[zoneIdx].id + "/command/action";

  if (action == "OPEN") {
    openValve(zoneIdx, "manual");
    Firebase.setString(fbdo, clearPath, "null");  // clear command
  } else if (action == "CLOSE") {
    closeValve(zoneIdx);
    Firebase.setString(fbdo, clearPath, "null");
  }
  lastFirebaseOkMs = millis();
}

// Stream callbacks
void streamCallbackZ1(StreamData data) {
  if (data.dataType() == "string") {
    String action = data.stringData();
    if (action != "null" && action.length() > 0) {
      Serial.printf("[Zone %s] Command received: %s\n", zones[0].id, action.c_str());
      handleCommand(0, action);
    }
  }
}

void streamCallbackZ2(StreamData data) {
  if (data.dataType() == "string") {
    String action = data.stringData();
    if (action != "null" && action.length() > 0) {
      Serial.printf("[Zone %s] Command received: %s\n", zones[1].id, action.c_str());
      handleCommand(1, action);
    }
  }
}

void streamTimeoutCallback(bool timeout) {
  if (timeout) {
    Serial.println("[Firebase] Stream timeout — will reconnect");
  }
}

// ---------------------------------------------------------------------------
// Firebase watchdog — restart if unreachable > FIREBASE_TIMEOUT_MS
// ---------------------------------------------------------------------------
void checkFirebaseWatchdog() {
  if (millis() - lastFirebaseOkMs > FIREBASE_TIMEOUT_MS) {
    Serial.println("[Watchdog] Firebase unreachable too long — rebooting");
    delay(500);
    ESP.restart();
  }
}

// ---------------------------------------------------------------------------
// setup()
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  Serial.println("\n[Boot] Irrigation controller starting...");

  // Relay pins — initialize HIGH (valve CLOSED) before anything else
  pinMode(RELAY_1_PIN, OUTPUT);
  pinMode(RELAY_2_PIN, OUTPUT);
  digitalWrite(RELAY_1_PIN, HIGH);
  digitalWrite(RELAY_2_PIN, HIGH);

  // ADC pins (input by default, explicit for clarity)
  pinMode(SENSOR_1_PIN, INPUT);
  pinMode(SENSOR_2_PIN, INPUT);

  // --- WiFi provisioning ---
  preferences.begin("wifi", true);
  wifiSSID     = preferences.getString("ssid", "");
  wifiPassword = preferences.getString("pass", "");
  preferences.end();

  if (wifiSSID.length() > 0) {
    Serial.printf("[WiFi] Connecting to %s ...\n", wifiSSID.c_str());
    WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());

    uint32_t startMs = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startMs < 20000) {
      delay(500);
      Serial.print(".");
    }
    Serial.println();
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Starting AP mode for provisioning...");
    WiFi.softAP(AP_SSID, AP_PASSWORD);
    Serial.printf("[WiFi] AP IP: %s\n", WiFi.softAPIP().toString().c_str());
    inAPMode = true;

    server.on("/",     handleProvRoot);
    server.on("/save", HTTP_POST, handleProvSave);
    server.begin();
    Serial.println("[WiFi] Provisioning server started — connect to ESP32_Config");
    return;  // loop() will only serve provisioning until reboot
  }

  Serial.printf("[WiFi] Connected, IP: %s\n", WiFi.localIP().toString().c_str());

  // --- Firebase init ---
  fbConfig.api_key               = FIREBASE_API_KEY;
  fbAuth.user.email              = FIREBASE_EMAIL;
  fbAuth.user.password           = FIREBASE_PASSWORD;
  fbConfig.database_url          = FIREBASE_DB_URL;
  fbConfig.token_status_callback = tokenStatusCallback;

  Firebase.reconnectNetwork(true);
  fbdo.setBSSLBufferSize(4096, 1024);
  streamZ1.setBSSLBufferSize(4096, 1024);
  streamZ2.setBSSLBufferSize(4096, 1024);

  Firebase.begin(&fbConfig, &fbAuth);

  // Wait briefly for token (non-blocking — Firebase.ready() handles it in loop)
  Serial.println("[Firebase] Initializing...");
  uint32_t fbWait = millis();
  while (!Firebase.ready() && millis() - fbWait < 10000) {
    delay(200);
  }

  if (Firebase.ready()) {
    lastFirebaseOkMs = millis();

    // Start command streams
    String cmdPath1 = String("/irrigation/zones/") + ZONE_1_ID + "/command/action";
    String cmdPath2 = String("/irrigation/zones/") + ZONE_2_ID + "/command/action";

    if (!Firebase.beginStream(streamZ1, cmdPath1)) {
      Serial.printf("[Firebase] Stream Z1 failed: %s\n", streamZ1.errorReason().c_str());
    }
    if (!Firebase.beginStream(streamZ2, cmdPath2)) {
      Serial.printf("[Firebase] Stream Z2 failed: %s\n", streamZ2.errorReason().c_str());
    }

    Firebase.setStreamCallback(streamZ1, streamCallbackZ1, streamTimeoutCallback);
    Firebase.setStreamCallback(streamZ2, streamCallbackZ2, streamTimeoutCallback);

    // Initial sensor read + heartbeat
    readAndPublishSensors();
    publishHeartbeat();
  } else {
    Serial.println("[Firebase] Not ready after timeout — continuing, watchdog will restart if needed");
  }

  Serial.println("[Boot] Setup complete");
}

// ---------------------------------------------------------------------------
// loop()
// ---------------------------------------------------------------------------
void loop() {
  if (inAPMode) {
    server.handleClient();
    return;
  }

  // Safety check runs every iteration — no timer needed
  enforceValveSafety();

  // Sensor publish every SENSOR_INTERVAL_MS
  if (millis() - lastSensorMs >= SENSOR_INTERVAL_MS) {
    lastSensorMs = millis();
    if (Firebase.ready()) {
      readAndPublishSensors();
    }
  }

  // Heartbeat every HEARTBEAT_INTERVAL_MS
  if (millis() - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatMs = millis();
    if (Firebase.ready()) {
      publishHeartbeat();
    }
  }

  // Firebase watchdog
  checkFirebaseWatchdog();
}
