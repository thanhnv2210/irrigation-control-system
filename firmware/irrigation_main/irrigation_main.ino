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
// Schedule cache (M2)
// ---------------------------------------------------------------------------
#define MAX_SCHEDULES 10

struct ScheduleEntry {
  bool valid;
  int  hour;
  int  minute;
  int  durationMinutes;
  bool enabled;
  bool days[7];   // 0=Sun, 1=Mon, ... 6=Sat
};

ScheduleEntry schedules[2][MAX_SCHEDULES];  // [zoneIdx][scheduleIdx]
int           scheduleCount[2] = { 0, 0 };

// Per-zone: millis() when a schedule-triggered valve should close (0 = not active)
static uint32_t scheduleCloseAt[2] = { 0, 0 };

// Tracks the last minute (0–1439) each schedule slot fired — prevents double-trigger
static int lastFiredMin[2][MAX_SCHEDULES];

static uint32_t lastScheduleCheckMs = 0;
static uint32_t lastScheduleReloadMs = 0;

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
//         or past its scheduled duration
// ---------------------------------------------------------------------------
void enforceValveSafety() {
  for (int i = 0; i < 2; i++) {
    if (!zones[i].valveOpen) continue;

    // Schedule duration close
    if (scheduleCloseAt[i] > 0 && millis() >= scheduleCloseAt[i]) {
      Serial.printf("[Zone %s] Schedule duration elapsed, closing valve\n", zones[i].id);
      closeValve(i);
      scheduleCloseAt[i] = 0;
      continue;
    }

    // Hard safety cap
    if (millis() - zones[i].valveOpenedAt >= MAX_VALVE_MS) {
      Serial.printf("[Zone %s] SAFETY: max open time reached, closing valve\n", zones[i].id);
      closeValve(i);
      scheduleCloseAt[i] = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Schedule loading — reads all schedules from Firebase for both zones
// ---------------------------------------------------------------------------
void loadSchedules() {
  for (int zi = 0; zi < 2; zi++) {
    scheduleCount[zi] = 0;
    const char* zoneId = zones[zi].id;
    String path = String("/irrigation/zones/") + zoneId + "/schedule";

    if (!Firebase.getJSON(fbdo, path)) {
      Serial.printf("[Schedule] Load failed for %s: %s\n", zoneId, fbdo.errorReason().c_str());
      continue;
    }

    FirebaseJson& json = fbdo.jsonObject();
    FirebaseJsonData result;
    size_t count = json.iteratorBegin();
    int idx = 0;

    for (size_t i = 0; i < count && idx < MAX_SCHEDULES; i++) {
      String key, value;
      int type;
      json.iteratorGet(i, type, key, value);

      // Each key is a schedule ID — get the nested object
      FirebaseJson entry;
      entry.setJsonData(value);
      FirebaseJsonData field;

      ScheduleEntry& s = schedules[zi][idx];
      s.valid = true;

      entry.get(field, "hour");            s.hour            = field.success ? field.intValue : 0;
      entry.get(field, "minute");          s.minute          = field.success ? field.intValue : 0;
      entry.get(field, "durationMinutes"); s.durationMinutes = field.success ? field.intValue : 5;
      entry.get(field, "enabled");         s.enabled         = field.success ? field.boolValue : false;

      // Parse days array [0,1,2,...] stored as JSON array string
      for (int d = 0; d < 7; d++) s.days[d] = false;
      entry.get(field, "days");
      if (field.success) {
        FirebaseJson daysJson;
        daysJson.setJsonData(field.stringValue);
        FirebaseJsonData dayVal;
        for (int d = 0; d < 7; d++) {
          daysJson.get(dayVal, String("[") + d + "]");
          if (dayVal.success) {
            int dayNum = dayVal.intValue;
            if (dayNum >= 0 && dayNum < 7) s.days[dayNum] = true;
          }
        }
      }

      lastFiredMin[zi][idx] = -1;  // reset fired tracker
      idx++;
    }

    json.iteratorEnd();
    scheduleCount[zi] = idx;
    lastFirebaseOkMs = millis();
    Serial.printf("[Schedule] Loaded %d entries for zone %s\n", idx, zoneId);
  }
}

// ---------------------------------------------------------------------------
// Schedule checker — call every minute
// ---------------------------------------------------------------------------
void checkSchedules() {
  struct tm timeInfo;
  if (!getLocalTime(&timeInfo)) {
    Serial.println("[Schedule] Time not available — skipping check");
    return;
  }

  int currentMin  = timeInfo.tm_hour * 60 + timeInfo.tm_min;
  int currentDay  = timeInfo.tm_wday;  // 0=Sun, 6=Sat

  for (int zi = 0; zi < 2; zi++) {
    if (zones[zi].valveOpen) continue;  // don't start if already open

    for (int si = 0; si < scheduleCount[zi]; si++) {
      ScheduleEntry& s = schedules[zi][si];
      if (!s.valid || !s.enabled) continue;
      if (!s.days[currentDay]) continue;

      int schedMin = s.hour * 60 + s.minute;
      if (schedMin != currentMin) continue;
      if (lastFiredMin[zi][si] == currentMin) continue;  // already fired this minute

      lastFiredMin[zi][si] = currentMin;
      uint32_t durationMs  = (uint32_t)s.durationMinutes * 60000UL;

      Serial.printf("[Schedule] Triggering zone %s at %02d:%02d for %d min\n",
        zones[zi].id, s.hour, s.minute, s.durationMinutes);

      openValve(zi, "schedule");
      scheduleCloseAt[zi] = millis() + durationMs;
    }
  }
}

// ---------------------------------------------------------------------------
// Sensors
// ---------------------------------------------------------------------------
void readAndPublishSensors() {
  for (int i = 0; i < 2; i++) {
    Zone& z = zones[i];
    int raw = analogRead(z.sensorPin);
    int pct = constrain(map(raw, z.dryRaw, z.wetRaw, 0, 100), 0, 100);

    String basePath = String("/irrigation/zones/") + z.id;

    // Overwrite current sensor reading
    FirebaseJson sensorJson;
    sensorJson.set("moisturePercent", pct);
    sensorJson.set("rawValue",        raw);
    sensorJson.set("timestamp/.sv",   "timestamp");

    if (Firebase.updateNode(fbdo, basePath + "/sensor", sensorJson)) {
      lastFirebaseOkMs = millis();
      Serial.printf("[Zone %s] Moisture: %d%% (raw %d)\n", z.id, pct, raw);
    } else {
      Serial.printf("[Zone %s] Sensor publish failed: %s\n", z.id, fbdo.errorReason().c_str());
      continue;
    }

    // Push to history for statistics (one entry per reading)
    FirebaseJson histJson;
    histJson.set("moisturePercent", pct);
    histJson.set("rawValue",        raw);
    histJson.set("timestamp/.sv",   "timestamp");

    String histPath = basePath + "/history";
    if (!Firebase.pushJSON(fbdo, histPath, histJson)) {
      Serial.printf("[Zone %s] History push failed: %s\n", z.id, fbdo.errorReason().c_str());
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

// ---------------------------------------------------------------------------
// Status report — printed when stream fires with no pending command
// ---------------------------------------------------------------------------
void reportZoneStatus(int zoneIdx) {
  Zone& z = zones[zoneIdx];
  int raw = analogRead(z.sensorPin);
  int pct = constrain(map(raw, z.dryRaw, z.wetRaw, 0, 100), 0, 100);

  Serial.printf("[Zone %s] Status — valve: %s | moisture: %d%% (raw %d) | uptime: %lus\n",
    z.id,
    z.valveOpen ? "OPEN" : "CLOSED",
    pct,
    raw,
    millis() / 1000
  );
}

// Stream callbacks
void streamCallbackZ1(StreamData data) {
  if (data.dataType() == "string") {
    String action = data.stringData();
    if (action != "null" && action.length() > 0) {
      Serial.printf("[Zone %s] Command received: %s\n", zones[0].id, action.c_str());
      handleCommand(0, action);
    } else {
      reportZoneStatus(0);
    }
  }
}

void streamCallbackZ2(StreamData data) {
  if (data.dataType() == "string") {
    String action = data.stringData();
    if (action != "null" && action.length() > 0) {
      Serial.printf("[Zone %s] Command received: %s\n", zones[1].id, action.c_str());
      handleCommand(1, action);
    } else {
      reportZoneStatus(1);
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

    // Load schedules on boot
    loadSchedules();
    lastScheduleReloadMs = millis();
  } else {
    Serial.println("[Firebase] Not ready after timeout — continuing, watchdog will restart if needed");
  }

  // NTP time sync
  configTime(TIMEZONE_OFFSET_SEC, 0, "pool.ntp.org", "time.nist.gov");
  Serial.println("[NTP] Waiting for time sync...");
  struct tm timeInfo;
  uint32_t ntpWait = millis();
  while (!getLocalTime(&timeInfo) && millis() - ntpWait < 10000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  if (getLocalTime(&timeInfo)) {
    Serial.printf("[NTP] Time synced: %02d:%02d:%02d\n",
      timeInfo.tm_hour, timeInfo.tm_min, timeInfo.tm_sec);
  } else {
    Serial.println("[NTP] Sync failed — schedules will not fire until time is available");
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

  // Reload schedules from Firebase every SCHEDULE_RELOAD_MS
  if (millis() - lastScheduleReloadMs >= SCHEDULE_RELOAD_MS) {
    lastScheduleReloadMs = millis();
    if (Firebase.ready()) {
      loadSchedules();
    }
  }

  // Check schedules every minute
  if (millis() - lastScheduleCheckMs >= 60000UL) {
    lastScheduleCheckMs = millis();
    checkSchedules();
  }

  // Firebase watchdog
  checkFirebaseWatchdog();
}
