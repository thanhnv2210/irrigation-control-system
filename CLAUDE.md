# CLAUDE.md — Irrigation Control System

This file is the project brief for Claude Code. Read it fully before taking any action.

---

## Project Goal

Build a smart irrigation system for a balcony and garden with:
- **ESP32 firmware** — reads soil moisture, controls a solenoid valve via relay
- **Firebase RTDB** — real-time data store and command channel (no custom backend)
- **React PWA** — mobile-friendly dashboard for monitoring and manual control

The system must be safe, reliable, and operable from a phone. Physical plants are at stake.

---

## Repository Map

This repo (`irrigation-control-system`) holds all firmware sketches.
The companion admin app lives at:
- `/Users/ThanhNguyen/AI_WS/smart-home-admin` — Streamlit admin panel (Python, Firebase Admin SDK)
- `/Users/ThanhNguyen/Documents/ExperimentsWS/smart-home-admin` — same, with more complete version

The React PWA does not exist yet — it will be a new project in `/Users/ThanhNguyen/AI_WS/`.

---

## Existing Firmware Sketches

### `esp_32_auto_config_v1/` — WiFi Provisioning (REUSE AS-IS)
- ESP32 boots into AP mode (`ESP32_Config` / `123456789`)
- Serves a web form at `192.168.4.1` to capture SSID + password
- Saves credentials to flash via `Preferences` library
- On reboot, reads flash and connects to saved WiFi
- **Status:** Working. Do not rewrite — integrate into the main sketch by calling the same `Preferences` read at boot.

### `elb_peripheral_v1/` — TCP + Firebase Prototype (PARTIAL REUSE)
- Connects to WiFi (hardcoded — must be removed)
- Opens a TCP server on port 12345
- Receives JSON, POSTs username/email to Firebase RTDB
- **Status:** Proof of concept only. Reuse: WiFi + HTTPClient pattern. Discard: TCP server, hardcoded creds, username/email payload.

### `Firebase_Sample_2/` — Firebase Library Sample (REFERENCE ONLY)
- From the `FirebaseESP32` library by mobizt (k_suwatchai@hotmail.com)
- Shows: WiFi connect, Firebase init with email/password auth, RTDB read/write loop
- **Status:** Not original code. Use as a reference for FirebaseESP32 API calls only.

---

## Firebase Project

- **Project name:** `smarthomeapp-982da`
- **RTDB URL:** `smarthomeapp-982da-default-rtdb.asia-southeast1.firebasedatabase.app`
- **Auth:** Email/password (`nguyenvanthanh2210@gmail.com`) — credentials in `config.h` (gitignored)
- **Library:** `FirebaseESP32` by mobizt (Arduino library manager)
- **Existing data structure:**
  ```
  /iot2025/
    account/{account_id}/
      name: string
    devices/{account_id}/{device_id}/
      ... device data
  ```
- **New irrigation paths** (see Firebase Schema section below)

The `smart-home-admin` Streamlit app reads from this same Firebase project under the `iot2025`
product ID. The new irrigation data will live under a separate product ID (`irrigation`) to
avoid contaminating existing data.

---

## Architecture Decisions (Already Made)

| Decision | Choice | Reason |
|---|---|---|
| Backend | Firebase RTDB — no custom server | Already proven; ESP32 library exists; real-time push built-in; free tier sufficient |
| Protocol | Firebase direct — not MQTT | Firebase SDK handles real-time sync; MQTT adds a broker to host with no benefit at this scale |
| WiFi provisioning | Captive portal (`esp_32_auto_config_v1`) | Avoids hardcoding credentials; user-friendly setup via phone browser |
| Frontend | React PWA — new project | Streamlit is not mobile-friendly; PWA installs on phone |
| Firmware language | Arduino C++ | ESP32 library ecosystem; existing code base |
| Zones | 2 zones — balcony and garden bed | Starting minimal; schema supports N zones |
| Data storage — MVP | Firebase RTDB for everything | No backend service exists; Firebase handles config, real-time ops, and command channel without a server |
| Data storage — future | PostgreSQL for config + history, Firebase for real-time | When a backend API exists: zones/schedules/thresholds/history move to Postgres; ESP32 firmware unchanged (backend syncs config to Firebase) |

**Do not re-open these decisions without a clear reason.**

### Storage Split — Deferred Until a Backend API Exists

The split between PostgreSQL and Firebase was evaluated and deliberately deferred.
Context for when to revisit:

- **Trigger:** A Spring Boot or FastAPI backend service is running and reachable from the ESP32's network
- **What moves to PostgreSQL:** zone config, schedules, thresholds, historical sensor readings, valve event log
- **What stays on Firebase:** live sensor state, current valve state, command channel, device heartbeat
- **Firmware impact:** zero — backend syncs Postgres config changes into Firebase; ESP32 reads Firebase as today
- **PWA impact:** config writes go to backend API instead of Firebase directly

Until then, treat Firebase as the single source of truth for all data.

---

## Firebase RTDB Schema

```
/irrigation/
  zones/
    {zone_id}/                     # e.g. "balcony", "garden"
      meta/
        name: string               # display name
        enabled: boolean
      sensor/
        moisturePercent: number    # 0–100, written by ESP32 every 30s
        rawValue: number           # raw ADC reading (0–4095)
        timestamp: number          # ServerValue.TIMESTAMP (ms)
      valve/
        state: "OPEN" | "CLOSED"  # written by ESP32 after acting
        lastChangedAt: number      # ms
        openedBy: "auto" | "manual" | "schedule"
      command/
        action: "OPEN" | "CLOSE" | null   # written by app, cleared by ESP32 after acting
        issuedAt: number
        issuedBy: string
      schedule/
        {schedule_id}/
          hour: number             # 0–23
          minute: number           # 0–59
          durationMinutes: number  # 1–60
          enabled: boolean
          days: [0,1,2,3,4,5,6]   # 0=Sun, 6=Sat
  devices/
    {device_id}/
      firmware: string            # version string
      lastSeen: number            # timestamp
      ipAddress: string
      wifiRssi: number
```

**Command pattern:** App writes `command/action = "OPEN"`. ESP32 reads it, acts on the relay,
writes back `valve/state`, then clears `command/action` to `null`. This prevents re-execution
on ESP32 restart.

---

## Firmware Architecture

The production firmware sketch will be a new file (e.g., `irrigation_main/irrigation_main.ino`).
It combines logic from the existing sketches:

```
setup()
  ├── Serial.begin()
  ├── Read WiFi creds from Preferences (from esp_32_auto_config_v1 pattern)
  ├── If no creds → start AP mode for provisioning
  ├── WiFi.begin() + timeout loop
  ├── Firebase.begin() with config from config.h
  └── Set up Firebase listener on /irrigation/zones/{zone_id}/command/action

loop()
  ├── server.handleClient()         # serve provisioning page if in AP mode
  ├── readAndPublishSensors()       # every SENSOR_INTERVAL_MS (30,000)
  ├── checkSchedules()              # every minute
  ├── checkFirebaseCommands()       # continuous listener callback
  └── enforceValveSafety()          # close valve if open > MAX_VALVE_MS (600,000)
```

### Safety Rules (Non-Negotiable)

1. **Max valve open time: 10 minutes (600,000 ms)** — enforced in firmware regardless of any Firebase command or schedule
2. **Cold start default: valve CLOSED** — relay initializes HIGH (active LOW relay)
3. **WiFi loss: hold last valve state** — do not open or close on reconnect
4. **Firebase loss: hold last valve state** — do not reset automation

### Credentials Policy

- WiFi SSID/password: stored in flash via `Preferences`, never in source code
- Firebase API key, email, password, DB URL: in `config.h` (gitignored)
- `config.h.example` is committed with placeholder values

```cpp
// config.h.example — copy to config.h and fill in
#define FIREBASE_API_KEY     "your-api-key"
#define FIREBASE_EMAIL       "your-email"
#define FIREBASE_PASSWORD    "your-password"
#define FIREBASE_DB_URL      "your-db.region.firebasedatabase.app"
#define ZONE_1_ID            "balcony"
#define ZONE_2_ID            "garden"
#define SENSOR_1_PIN         34
#define SENSOR_2_PIN         35
#define RELAY_1_PIN          26
#define RELAY_2_PIN          27
#define MAX_VALVE_MS         600000   // 10 minutes
#define SENSOR_INTERVAL_MS   30000   // 30 seconds
```

---

## React PWA (Planned — Not Started)

**Location:** `/Users/ThanhNguyen/AI_WS/irrigation-pwa` (new repo, not yet created)

**Stack:**
- React 18 + Vite
- Firebase JS SDK v9 (modular)
- PWA: `vite-plugin-pwa` + manifest
- Auth: none (personal tool, Firebase security rules restrict access)

**Views:**
1. **Dashboard** — moisture per zone (gauge), valve state, last watered time, device last seen
2. **Control** — manual OPEN/CLOSE per zone with confirmation dialog
3. **Schedule** — add/edit/delete schedules per zone (hour, duration, days)
4. **Settings** — zone names, moisture thresholds for alerts

**Key implementation rules:**
- All Firebase reads via `onValue()` (real-time subscriptions), unsubscribed on unmount
- Manual trigger writes to `command/` path — never writes `valve/state` directly
- Confirmation dialog required before any valve OPEN command
- Mobile-first: minimum 375px viewport, no horizontal scroll

---

## Hardware

| Component | Spec | Pin |
|---|---|---|
| MCU | ESP32 (38-pin DevKit) | — |
| Soil sensor 1 | Capacitive v1.2 | GPIO 34 (ADC1) |
| Soil sensor 2 | Capacitive v1.2 | GPIO 35 (ADC1) |
| Relay 1 | 5V active-LOW single relay | GPIO 26 |
| Relay 2 | 5V active-LOW single relay | GPIO 27 |
| Solenoid valve | 12V DC | via relay 1/2 |
| Power | 12V adapter + AMS1117 buck to 3.3V | — |
| Optional | DHT22 temp/humidity | GPIO 4 |

**Sensor calibration:** Raw ADC values (0–4095) must be measured per sensor:
- `DRY_RAW` = reading in completely dry soil (record after calibration)
- `WET_RAW` = reading in saturated soil (record after calibration)
- `moisturePercent = map(rawValue, DRY_RAW, WET_RAW, 0, 100)`

Calibration values go in `config.h` after physical measurement — not before.

---

## Development Milestones

### M1 — Firmware: Core Loop (current focus)
- [ ] Create `irrigation_main/` sketch
- [ ] Create `config.h.example`
- [ ] WiFi: read from flash (from `esp_32_auto_config_v1`) + AP fallback
- [ ] Sensor: read ADC, map to percent, publish to Firebase
- [ ] Relay: initialize CLOSED, control function with safety cutoff
- [ ] Firebase listener: react to `command/action`, clear after acting
- [ ] Watchdog: restart if Firebase unreachable > 5 min

### M2 — Firmware: Schedules + Multi-zone
- [ ] Read schedules from Firebase on boot + listen for changes
- [ ] Schedule executor: check time every minute, trigger valve if match
- [ ] Support 2 zones independently

### M3 — React PWA: Dashboard + Manual Control
- [ ] Scaffold: Vite + React + `vite-plugin-pwa`
- [ ] Firebase init + `useZoneData` hook
- [ ] Dashboard view
- [ ] Manual control view with confirmation

### M4 — React PWA: Schedule Editor
- [ ] Schedule view: list, add, edit, delete
- [ ] Write schedules to Firebase

### M5 — Hardening
- [ ] Firebase security rules: device writes restricted to sensor + valve paths
- [ ] Low moisture alert (in-app notification or Telegram)
- [ ] Seasonal threshold review after 4 weeks of operation data

---

## What Claude Should and Should Not Do

### Claude owns:
- Writing and refactoring firmware code
- Proposing Firebase schema changes (author approves)
- Scaffolding React components and hooks
- Writing Firebase security rules
- Drafting test cases for logic that can be tested without hardware

### Author owns:
- Calibration values (`DRY_RAW`, `WET_RAW`) — measured from real hardware
- Safety thresholds (`MAX_VALVE_MS`) — physical safety decision
- Firebase credentials — never generated or stored by Claude
- All physical verification — flashing, wiring, sensor readings
- Final approval before any valve test with water supply active

### Never do:
- Hardcode WiFi credentials, Firebase API keys, email, or passwords in any file
- Remove or reduce the 10-minute valve safety cutoff
- Write `valve/state` directly from the app — always go via `command/` channel
- Use `delay()` inside `loop()` — use `millis()` for all timing

---

## 4D Framework Reference

This project applies the 4D Framework (Delegation, Description, Discernment, Diligence)
across all phases. The full practice log is in the architecture-practice viewer:

`/Users/ThanhNguyen/AI_WS/architecture-practice/public/docs/irrigation/4d-irrigation-system.md`

Key principle: Claude assists with code and analysis. The author owns physical verification,
safety decisions, credentials, and calibration. Claude cannot close the hardware-in-the-loop.

---

## Running the Existing Streamlit Admin (for Firebase reference)

```bash
cd /Users/ThanhNguyen/AI_WS/smart-home-admin
# or the more complete version:
cd /Users/ThanhNguyen/Documents/ExperimentsWS/smart-home-admin

python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Create .env:
# FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json
# FIREBASE_DATABASE_URL=https://smarthomeapp-982da-default-rtdb.asia-southeast1.firebasedatabase.app

streamlit run app.py
```

The `serviceAccountKey.json` is present in `ExperimentsWS/smart-home-admin/` but gitignored.
Use this app to inspect Firebase data structure during development.

---

## Current State (as of 2026-06-07)

- Hardware: not yet assembled
- Firmware: 3 sketches exist (see above), production sketch not started
- Firebase: project exists, `iot2025` data present, `irrigation` path empty
- React PWA: not started
- Streamlit admin: working, reads from Firebase

Next action: create `irrigation_main/` sketch + `config.h.example`, integrating WiFi provisioning
from `esp_32_auto_config_v1` and Firebase from `Firebase_Sample_2` as reference.
