/**
 * irrigation_main.ino
 * Smart Irrigation Controller — ESP32
 *
 * Zones: balcony (zone 1), garden (zone 2)
 * Firebase RTDB path: irrigation/sites/{SITE_ID}/zones/{zone_id}/
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
FirebaseData streamConfig; // Stream for device config changes
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
  bool        sensorEnabled;  // false = no physical sensor, skip reads

  bool     valveOpen;
  uint32_t valveOpenedAt;  // millis() when valve was opened
};

Zone zones[2] = {
  { ZONE_1_ID, SENSOR_1_PIN, RELAY_1_PIN, DRY_RAW_1, WET_RAW_1, ZONE_1_SENSOR_ENABLED, false, 0 },
  { ZONE_2_ID, SENSOR_2_PIN, RELAY_2_PIN, DRY_RAW_2, WET_RAW_2, ZONE_2_SENSOR_ENABLED, false, 0 },
};

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------
static uint32_t lastSensorMs    = 0;
static uint32_t lastHeartbeatMs = 0;
static uint32_t lastFirebaseOkMs = 0;  // tracks last successful Firebase call
static uint32_t offlineStartMs   = 0;  // millis() when connectivity was lost

// Runtime config — overridable from Firebase without reflashing
static uint32_t runtimeSensorIntervalMs = SENSOR_INTERVAL_MS;

// ---------------------------------------------------------------------------
// Path helper — all data lives under irrigation/sites/{SITE_ID}/
// ---------------------------------------------------------------------------
static String zonePath(const char* zoneId) {
  return String("irrigation/sites/") + SITE_ID + "/devices/" + DEVICE_ID + "/zones/" + zoneId;
}
static String devicePath() {
  return String("irrigation/sites/") + SITE_ID + "/devices/" + DEVICE_ID + "/meta";
}
static String configPath() {
  return String("irrigation/sites/") + SITE_ID + "/devices/" + DEVICE_ID + "/config";
}

// ---------------------------------------------------------------------------
// Config stream callback — applies PWA-written config changes at runtime
// ---------------------------------------------------------------------------
void applyConfigSensorInterval(int requested) {
  if (requested < 10000)  requested = 10000;
  if (requested > 300000) requested = 300000;
  if ((uint32_t)requested != runtimeSensorIntervalMs) {
    runtimeSensorIntervalMs = (uint32_t)requested;
    lastSensorMs = millis() - runtimeSensorIntervalMs;  // take effect immediately
    Serial.printf("[Config] sensorIntervalMs updated to %lu ms\n", runtimeSensorIntervalMs);
  } else {
    Serial.printf("[Config] sensorIntervalMs unchanged (%lu ms)\n", runtimeSensorIntervalMs);
  }
}

void applyConfigSensorEnabled(const String& zoneId, bool enabled) {
  for (int i = 0; i < 2; i++) {
    if (String(zones[i].id) == zoneId) {
      zones[i].sensorEnabled = enabled;
      Serial.printf("[Config] Zone %s sensor %s\n", zones[i].id, enabled ? "ENABLED" : "DISABLED");
      return;
    }
  }
  Serial.printf("[Config] sensorEnabled: unknown zone '%s'\n", zoneId.c_str());
}

void configStreamCallback(StreamData data) {
  String path  = data.dataPath();
  String dtype = data.dataType();
  Serial.printf("[Config] Stream fired — path=%s dataType=%s\n", path.c_str(), dtype.c_str());

  lastFirebaseOkMs = millis();

  if (path == "/sensorIntervalMs") {
    if (dtype == "int" || dtype == "float" || dtype == "double" || dtype == "number") {
      applyConfigSensorInterval((int)data.floatData());
    }
  } else if (path.startsWith("/sensorEnabled/")) {
    String zoneId = path.substring(15);  // strip "/sensorEnabled/"
    if (dtype == "boolean") {
      applyConfigSensorEnabled(zoneId, data.boolData());
    }
  } else {
    Serial.printf("[Config] Unhandled path: %s\n", path.c_str());
  }
}

// ---------------------------------------------------------------------------
// Relay control
// ---------------------------------------------------------------------------
void openValve(int zoneIdx, const char* openedBy) {
  Zone& z = zones[zoneIdx];
  Serial.printf("[Zone %s] openValve() called — current valveOpen=%s\n", z.id, z.valveOpen ? "true" : "false");
  if (z.valveOpen) {
    Serial.printf("[Zone %s] Already open — skipping\n", z.id);
    return;
  }

  digitalWrite(z.relayPin, LOW);  // Active-LOW relay
  z.valveOpen     = true;
  z.valveOpenedAt = millis();
  Serial.printf("[Zone %s] Relay pin %d set LOW (open)\n", z.id, z.relayPin);

  String base = zonePath(z.id);
  bool ok1 = Firebase.setString(fbdo, base + "/valve/state",    "OPEN");
  bool ok2 = Firebase.setString(fbdo, base + "/valve/openedBy", openedBy);
  bool ok3 = Firebase.setInt   (fbdo, base + "/valve/lastChangedAt", (int)millis());
  Serial.printf("[Zone %s] Valve OPEN (by %s) — Firebase writes: state=%s openedBy=%s ts=%s\n",
    z.id, openedBy,
    ok1 ? "ok" : fbdo.errorReason().c_str(),
    ok2 ? "ok" : fbdo.errorReason().c_str(),
    ok3 ? "ok" : fbdo.errorReason().c_str());
}

void closeValve(int zoneIdx) {
  Zone& z = zones[zoneIdx];
  Serial.printf("[Zone %s] closeValve() called — internal valveOpen=%s | relay pin=%d | pin state=%d\n",
    z.id, z.valveOpen ? "true" : "false", z.relayPin, digitalRead(z.relayPin));

  if (!z.valveOpen) {
    // Force relay and Firebase to CLOSED even if internal state disagrees — safety net
    Serial.printf("[Zone %s] Internal state says CLOSED but forcing relay+Firebase sync\n", z.id);
    digitalWrite(z.relayPin, HIGH);
    String base = zonePath(z.id);
    bool ok = Firebase.setString(fbdo, base + "/valve/state", "CLOSED");
    Serial.printf("[Zone %s] Firebase sync result: %s\n", z.id, ok ? "ok" : fbdo.errorReason().c_str());
    return;
  }

  digitalWrite(z.relayPin, HIGH);  // Active-LOW relay — HIGH = off
  z.valveOpen = false;

  String base = zonePath(z.id);
  bool ok = Firebase.setString(fbdo, base + "/valve/state", "CLOSED");
  Firebase.setInt(fbdo, base + "/valve/lastChangedAt", (int)millis());
  Serial.printf("[Zone %s] Valve CLOSED — Firebase write: %s\n", z.id, ok ? "ok" : fbdo.errorReason().c_str());
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
    String path = zonePath(zoneId) + "/schedule";

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
    if (!z.sensorEnabled) {
      Serial.printf("[Zone %s] Sensor disabled — skipping read\n", z.id);
      continue;
    }
    int raw = analogRead(z.sensorPin);
    int pct = constrain(map(raw, z.dryRaw, z.wetRaw, 0, 100), 0, 100);

    String base = zonePath(z.id);

    // Overwrite current sensor reading
    FirebaseJson sensorJson;
    sensorJson.set("moisturePercent", pct);
    sensorJson.set("rawValue",        raw);
    sensorJson.set("timestamp/.sv",   "timestamp");

    if (Firebase.updateNode(fbdo, base + "/sensor", sensorJson)) {
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
    histJson.set("valveOpen",       z.valveOpen);

    if (!Firebase.pushJSON(fbdo, base + "/history", histJson)) {
      Serial.printf("[Zone %s] History push failed: %s\n", z.id, fbdo.errorReason().c_str());
    }
  }
}

// ---------------------------------------------------------------------------
// Device heartbeat
// ---------------------------------------------------------------------------
void publishHeartbeat() {
  FirebaseJson json;
  json.set("firmware",          FIRMWARE_VERSION);
  json.set("lastSeen/.sv",      "timestamp");
  json.set("ipAddress",         WiFi.localIP().toString());
  json.set("wifiRssi",          WiFi.RSSI());
  json.set("sensorIntervalMs",   (int)runtimeSensorIntervalMs);
  json.set("heartbeatIntervalMs",(int)HEARTBEAT_INTERVAL_MS);
  json.set("maxValveMs",         (int)MAX_VALVE_MS);

  if (Firebase.updateNode(fbdo, devicePath(), json)) {
    lastFirebaseOkMs = millis();
  }
}

// ---------------------------------------------------------------------------
// Command handler (called from stream callbacks)
// ---------------------------------------------------------------------------
void handleCommand(int zoneIdx, const String& action) {
  String cmdBase  = zonePath(zones[zoneIdx].id) + "/command";

  Serial.printf("[Cmd] handleCommand zone=%s action=%s\n", zones[zoneIdx].id, action.c_str());

  if (action == "OPEN") {
    // Read durationSeconds from command — default 30s, clamp 30–540s (9 min)
    int durationSeconds = 30;
    if (Firebase.getInt(fbdo, cmdBase + "/durationSeconds")) {
      int val = fbdo.intData();
      Serial.printf("[Cmd] durationSeconds from Firebase: %d\n", val);
      if (val >= 30 && val <= 540) durationSeconds = val;
    } else {
      Serial.printf("[Cmd] durationSeconds read failed: %s — using default 30s\n", fbdo.errorReason().c_str());
    }

    openValve(zoneIdx, "manual");
    scheduleCloseAt[zoneIdx] = millis() + (uint32_t)durationSeconds * 1000UL;
    Serial.printf("[Zone %s] Manual open for %ds, will close at millis=%lu\n",
      zones[zoneIdx].id, durationSeconds, scheduleCloseAt[zoneIdx]);

    bool cleared = Firebase.setString(fbdo, cmdBase + "/action", "null");
    Serial.printf("[Cmd] OPEN command cleared: %s\n", cleared ? "ok" : fbdo.errorReason().c_str());

  } else if (action == "CLOSE") {
    closeValve(zoneIdx);
    scheduleCloseAt[zoneIdx] = 0;
    bool cleared = Firebase.setString(fbdo, cmdBase + "/action", "null");
    Serial.printf("[Cmd] CLOSE command cleared: %s\n", cleared ? "ok" : fbdo.errorReason().c_str());
  } else {
    Serial.printf("[Cmd] Unknown action ignored: \"%s\"\n", action.c_str());
  }
  lastFirebaseOkMs = millis();
}

// ---------------------------------------------------------------------------
// Status report — printed when stream fires with no pending command
// ---------------------------------------------------------------------------
void reportZoneStatus(int zoneIdx) {
  Zone& z = zones[zoneIdx];
  if (z.sensorEnabled) {
    int raw = analogRead(z.sensorPin);
    int pct = constrain(map(raw, z.dryRaw, z.wetRaw, 0, 100), 0, 100);
    Serial.printf("[Zone %s] Status — valve: %s | moisture: %d%% (raw %d) | uptime: %lus\n",
      z.id, z.valveOpen ? "OPEN" : "CLOSED", pct, raw, millis() / 1000);
  } else {
    Serial.printf("[Zone %s] Status — valve: %s | sensor: disabled | uptime: %lus\n",
      z.id, z.valveOpen ? "OPEN" : "CLOSED", millis() / 1000);
  }
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
    if (offlineStartMs == 0) offlineStartMs = millis();
    Serial.println("[Firebase] Stream timeout — will reconnect");
  }
}

// ---------------------------------------------------------------------------
// Firebase watchdog — restart if unreachable > FIREBASE_TIMEOUT_MS
// ---------------------------------------------------------------------------
void checkFirebaseWatchdog() {
  if (millis() - lastFirebaseOkMs > FIREBASE_TIMEOUT_MS) {
    Serial.println("[Watchdog] Firebase unreachable too long — rebooting");
    offlineStartMs = lastFirebaseOkMs;  // offline since last successful Firebase call
    publishDiagnostic("watchdog_reboot");
    delay(1000);
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

  // --- Boot config dump ---
  Serial.println("[Config] ========== Current Configuration ==========");
  Serial.printf ("[Config] Firmware version : %s\n",   FIRMWARE_VERSION);
  Serial.printf ("[Config] Device ID        : %s\n",   DEVICE_ID);
  Serial.printf ("[Config] Device name      : %s\n",   DEVICE_NAME);
  Serial.printf ("[Config] Site ID          : %s\n",   SITE_ID);
  Serial.printf ("[Config] Zone 1           : %s\n",   ZONE_1_ID);
  Serial.printf ("[Config] Zone 2           : %s\n",   ZONE_2_ID);
  Serial.printf ("[Config] WiFi SSID        : %s\n",   WIFI_SSID);
  Serial.printf ("[Config] Sensor 1 pin     : GPIO %d\n", SENSOR_1_PIN);
  Serial.printf ("[Config] Sensor 2 pin     : GPIO %d\n", SENSOR_2_PIN);
  Serial.printf ("[Config] Relay 1 pin      : GPIO %d\n", RELAY_1_PIN);
  Serial.printf ("[Config] Relay 2 pin      : GPIO %d\n", RELAY_2_PIN);
  Serial.printf ("[Config] DRY_RAW_1        : %d\n",   DRY_RAW_1);
  Serial.printf ("[Config] WET_RAW_1        : %d\n",   WET_RAW_1);
  Serial.printf ("[Config] DRY_RAW_2        : %d\n",   DRY_RAW_2);
  Serial.printf ("[Config] WET_RAW_2        : %d\n",   WET_RAW_2);
  Serial.printf ("[Config] MAX_VALVE_MS     : %lu ms\n", MAX_VALVE_MS);
  Serial.printf ("[Config] SENSOR_INTERVAL  : %lu ms\n", SENSOR_INTERVAL_MS);
  Serial.printf ("[Config] TIMEZONE_OFFSET  : %d sec\n", TIMEZONE_OFFSET_SEC);
#if DEBUG_PRINT_SECRETS
  Serial.println("[Config] --- Sensitive values (DEBUG_PRINT_SECRETS=1) ---");
  Serial.printf ("[Config] WiFi password    : %s\n",   WIFI_PASSWORD);
  Serial.printf ("[Config] Firebase API key : %s\n",   FIREBASE_API_KEY);
  Serial.printf ("[Config] Firebase email   : %s\n",   FIREBASE_EMAIL);
  Serial.printf ("[Config] Firebase password: %s\n",   FIREBASE_PASSWORD);
  Serial.printf ("[Config] Firebase DB URL  : %s\n",   FIREBASE_DB_URL);
#else
  Serial.println("[Config] Sensitive values hidden (set DEBUG_PRINT_SECRETS=1 to reveal)");
#endif
  Serial.println("[Config] ================================================");

  // --- WiFi provisioning ---
  preferences.begin("wifi", true);
  wifiSSID     = preferences.getString("ssid", "");
  wifiPassword = preferences.getString("pass", "");
  preferences.end();

  // Fall back to compile-time credentials if flash has nothing
  if (wifiSSID.length() == 0 && strlen(WIFI_SSID) > 0) {
    wifiSSID     = WIFI_SSID;
    wifiPassword = WIFI_PASSWORD;
    Serial.println("[WiFi] No saved credentials — using config.h defaults");
  }

  if (wifiSSID.length() > 0) {
    Serial.printf("[WiFi] Connecting to %s ...\n", wifiSSID.c_str());
    WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());

    uint32_t startMs = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startMs < 20000) {
      delay(500);
      Serial.print(".");
    }
    Serial.println();

    if (WiFi.status() != WL_CONNECTED) {
      int wifiStatus = WiFi.status();
      // WL_IDLE_STATUS=0, WL_NO_SSID_AVAIL=1, WL_CONNECT_FAILED=4, WL_DISCONNECTED=6
      Serial.printf("[WiFi] Connection failed — status code: %d\n", wifiStatus);
      if (wifiStatus == WL_NO_SSID_AVAIL) {
        Serial.printf("[WiFi] SSID '%s' not found — check name or move closer to router\n", wifiSSID.c_str());
      } else if (wifiStatus == WL_CONNECT_FAILED) {
        Serial.println("[WiFi] Wrong password");
      } else {
        Serial.println("[WiFi] Unknown error — check router 2.4GHz band is enabled");
      }
    }
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
    String cmdPath1 = zonePath(ZONE_1_ID) + "/command/action";
    String cmdPath2 = zonePath(ZONE_2_ID) + "/command/action";

    if (!Firebase.beginStream(streamZ1, cmdPath1)) {
      Serial.printf("[Firebase] Stream Z1 failed: %s\n", streamZ1.errorReason().c_str());
    }
    if (!Firebase.beginStream(streamZ2, cmdPath2)) {
      Serial.printf("[Firebase] Stream Z2 failed: %s\n", streamZ2.errorReason().c_str());
    }

    Firebase.setStreamCallback(streamZ1, streamCallbackZ1, streamTimeoutCallback);
    Firebase.setStreamCallback(streamZ2, streamCallbackZ2, streamTimeoutCallback);

    // Register device name only if it does not exist yet — never overwrite a name set via PWA
    {
      bool exists = Firebase.getString(fbdo, devicePath() + "/name") && fbdo.stringData().length() > 0;
      if (!exists) {
        Firebase.setString(fbdo, devicePath() + "/name", DEVICE_NAME);
        Serial.println("[Device] Name initialised: " DEVICE_NAME);
      } else {
        Serial.printf("[Device] Name kept: %s\n", fbdo.stringData().c_str());
      }
    }

    // Register zone meta only if it does not exist yet — never overwrite a name set via PWA
    for (int i = 0; i < 2; i++) {
      String metaPath = zonePath(zones[i].id) + "/meta";
      bool exists = Firebase.getString(fbdo, metaPath + "/name") && fbdo.stringData().length() > 0;
      if (!exists) {
        Firebase.setString(fbdo, metaPath + "/name",    zones[i].id);
        Firebase.setBool  (fbdo, metaPath + "/enabled", true);
        Serial.printf("[Zone %s] Meta initialised\n", zones[i].id);
      } else {
        Serial.printf("[Zone %s] Name kept: %s\n", zones[i].id, fbdo.stringData().c_str());
      }
    }

    // Force all valves CLOSED and clear any pending commands on boot
    for (int i = 0; i < 2; i++) {
      digitalWrite(zones[i].relayPin, HIGH);  // hardware close first — always
      zones[i].valveOpen   = false;
      scheduleCloseAt[i]   = 0;

      String statePath = zonePath(zones[i].id) + "/valve/state";
      String cmdPath   = zonePath(zones[i].id) + "/command/action";

      bool wasOpen = false;
      if (Firebase.getString(fbdo, statePath)) {
        wasOpen = fbdo.stringData() == "OPEN";
      }
      Firebase.setString(fbdo, statePath, "CLOSED");

      // Clear any stale pending command — prevents PWA showing "waiting for device"
      String pendingCmd = "";
      if (Firebase.getString(fbdo, cmdPath)) {
        pendingCmd = fbdo.stringData();
      }
      if (pendingCmd.length() > 0 && pendingCmd != "null") {
        Firebase.setString(fbdo, cmdPath, "null");
        Serial.printf("[Zone %s] Boot: cleared stale command '%s'\n", zones[i].id, pendingCmd.c_str());
      }

      Serial.printf("[Zone %s] Boot: relay CLOSED | Firebase was %s — now CLOSED\n",
        zones[i].id, wasOpen ? "OPEN" : "CLOSED");
    }

    // Initial sensor read + heartbeat
    readAndPublishSensors();
    publishHeartbeat();

    // Load schedules on boot
    loadSchedules();
    lastScheduleReloadMs = millis();

    // Read runtime config on boot
    if (Firebase.getInt(fbdo, configPath() + "/sensorIntervalMs")) {
      int val = fbdo.intData();
      if (val >= 10000 && val <= 300000) {
        runtimeSensorIntervalMs = (uint32_t)val;
        Serial.printf("[Config] Boot: sensorIntervalMs = %lu ms (from Firebase)\n", runtimeSensorIntervalMs);
      }
    } else {
      Serial.println("[Config] No saved sensorIntervalMs — using config.h default");
    }

    for (int i = 0; i < 2; i++) {
      String path = configPath() + "/sensorEnabled/" + zones[i].id;
      if (Firebase.getBool(fbdo, path)) {
        zones[i].sensorEnabled = fbdo.boolData();
        Serial.printf("[Config] Boot: zone %s sensor %s\n",
          zones[i].id, zones[i].sensorEnabled ? "ENABLED" : "DISABLED");
      } else {
        // Path doesn't exist yet — write the compile-time default so PWA can see it
        Firebase.setBool(fbdo, path, zones[i].sensorEnabled);
        Serial.printf("[Config] Boot: zone %s sensor default written (%s)\n",
          zones[i].id, zones[i].sensorEnabled ? "enabled" : "disabled");
      }
    }

    // Stream the full config/ node — callback routes on dataPath()
    if (!Firebase.beginStream(streamConfig, configPath())) {
      Serial.printf("[Firebase] Config stream failed: %s\n", streamConfig.errorReason().c_str());
    }
    Firebase.setStreamCallback(streamConfig, configStreamCallback, streamTimeoutCallback);
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
// ---------------------------------------------------------------------------
// Diagnostic snapshot — written to Firebase when connectivity is restored
// Tells you what happened during an offline period without Serial Monitor
// ---------------------------------------------------------------------------
void publishDiagnostic(const char* reason) {
  uint32_t offlineDurationMs = (offlineStartMs > 0) ? (millis() - offlineStartMs) : 0;
  int offlineSec = offlineDurationMs / 1000;

  FirebaseJson diag;
  diag.set("reason",         reason);
  diag.set("offlineSec",     offlineSec);
  diag.set("uptimeSec",      (int)(millis() / 1000));
  diag.set("wifiRssi",       WiFi.RSSI());
  diag.set("ipAddress",      WiFi.localIP().toString());
  diag.set("freeHeap",       (int)ESP.getFreeHeap());
  diag.set("timestamp/.sv",  "timestamp");

  String path = String(devicePath()) + "/lastDiagnostic";
  if (Firebase.updateNode(fbdo, path, diag)) {
    Serial.printf("[Diag] Snapshot written — reason: %s | offline: %ds | heap: %d\n",
      reason, offlineSec, ESP.getFreeHeap());
  } else {
    Serial.printf("[Diag] Snapshot write failed: %s\n", fbdo.errorReason().c_str());
  }
  offlineStartMs = 0;  // reset
}

// WiFi reconnect — monitors connection and reconnects if lost
// ---------------------------------------------------------------------------
static uint32_t lastWifiCheckMs   = 0;
static bool     wifiWasConnected  = false;

void checkWifi() {
  bool connected = WiFi.status() == WL_CONNECTED;

  if (!connected) {
    if (wifiWasConnected) {
      offlineStartMs = millis();  // start tracking offline duration
      Serial.println("[WiFi] Connection lost — attempting reconnect...");
    }
    WiFi.disconnect();
    WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());

    uint32_t startMs = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startMs < 15000) {
      delay(500);
      Serial.print(".");
    }
    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("[WiFi] Reconnected, IP: %s | RSSI: %d dBm\n",
        WiFi.localIP().toString().c_str(), WiFi.RSSI());
      wifiWasConnected = true;
      publishDiagnostic("wifi_reconnected");
    } else {
      Serial.printf("[WiFi] Reconnect failed (status %d) — will retry\n", WiFi.status());
      wifiWasConnected = false;
    }
  } else {
    if (!wifiWasConnected) {
      Serial.printf("[WiFi] Connected, IP: %s | RSSI: %d dBm\n",
        WiFi.localIP().toString().c_str(), WiFi.RSSI());
      publishDiagnostic("wifi_reconnected");
    }
    wifiWasConnected = true;
  }
}

// Stream health check — restart any stream that has dropped
// ---------------------------------------------------------------------------
static uint32_t lastStreamCheckMs = 0;

void pollCommand(int zoneIdx) {
  // Note: sensorEnabled only disables sensor reads — valve commands are always polled
  String cmdPath = zonePath(zones[zoneIdx].id) + "/command/action";
  Serial.printf("[Cmd] Polling %s → %s\n", zones[zoneIdx].id, cmdPath.c_str());
  if (Firebase.getString(fbdo, cmdPath)) {
    String action = fbdo.stringData();
    action.trim();
    Serial.printf("[Cmd] Poll result for %s: \"%s\"\n", zones[zoneIdx].id, action.c_str());
    if (action.length() > 0 && action != "null") {
      handleCommand(zoneIdx, action);
    }
  } else {
    Serial.printf("[Cmd] Poll FAILED for %s: %s\n", zones[zoneIdx].id, fbdo.errorReason().c_str());
  }
}

void checkStreams() {
  String cmdPath1 = zonePath(ZONE_1_ID) + "/command/action";
  String cmdPath2 = zonePath(ZONE_2_ID) + "/command/action";

  bool z1ok = Firebase.readStream(streamZ1) && !streamZ1.streamTimeout();
  bool z2ok = Firebase.readStream(streamZ2) && !streamZ2.streamTimeout();
  Serial.printf("[Stream] Z1=%s Z2=%s\n", z1ok ? "OK" : "DROPPED", z2ok ? "OK" : "DROPPED");

  if (!z1ok) {
    Serial.println("[Stream] Restarting Z1");
    Firebase.beginStream(streamZ1, cmdPath1);
    Firebase.setStreamCallback(streamZ1, streamCallbackZ1, streamTimeoutCallback);
    pollCommand(0);
  }
  if (!z2ok) {
    Serial.println("[Stream] Restarting Z2");
    Firebase.beginStream(streamZ2, cmdPath2);
    Firebase.setStreamCallback(streamZ2, streamCallbackZ2, streamTimeoutCallback);
    pollCommand(1);
  }
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

  // Sensor publish every runtimeSensorIntervalMs (default SENSOR_INTERVAL_MS, overridable via Firebase)
  if (millis() - lastSensorMs >= runtimeSensorIntervalMs) {
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

  // WiFi check every 30 seconds
  if (millis() - lastWifiCheckMs >= 30000UL) {
    lastWifiCheckMs = millis();
    checkWifi();
  }

  // Stream health check every 10 seconds
  if (millis() - lastStreamCheckMs >= 10000UL) {
    lastStreamCheckMs = millis();
    if (Firebase.ready()) {
      checkStreams();
    }
  }

  // Command poll every 3 seconds — primary command mechanism, runs regardless of stream state
  static uint32_t lastCmdPollMs = 0;
  static uint32_t pollCount = 0;
  if (millis() - lastCmdPollMs >= 3000UL) {
    lastCmdPollMs = millis();
    pollCount++;
    Serial.printf("[Cmd] --- Poll #%lu | uptime %lus | Firebase.ready=%s ---\n",
      pollCount, millis() / 1000, Firebase.ready() ? "YES" : "NO");
    pollCommand(0);
    pollCommand(1);
  }

  // Firebase watchdog
  checkFirebaseWatchdog();
}
