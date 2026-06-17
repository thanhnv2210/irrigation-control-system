# Irrigation Control System — TODO

Last reviewed: 2026-06-17

---

## Current Repository State

| Item | Status |
|---|---|
| `firmware/esp_32_auto_config_v1/` | Working — WiFi captive portal, Preferences flash storage |
| `firmware/elb_peripheral_v1/` | Proof of concept only — reference only |
| `firmware/Firebase_Sample_2/` | Reference only |
| `firmware/irrigation_main/` | Complete — M1+M2 done, running on hardware |
| `config.h` | Board 1 active (`ACTIVE_BOARD 1`) — two-board toggle structure |
| Firebase `irrigation/` path | Live data flowing from esp32-01 |
| Firebase security rules | Deployed — `config/` read access added for device account |
| React PWA | Complete — Dashboard, Control, Schedule, Settings views |
| Hardware — esp32-01 | Assembled and running — sensors connected, valves tested |
| Hardware — esp32-02 | Assembled — no sensors connected yet |

---

## M1 — Firmware: Core Loop ✅

- [x] Create `irrigation_main/` sketch directory and `irrigation_main.ino`
- [x] Create `config.h.example` with all placeholder values
- [x] WiFi: read SSID/password from `Preferences` flash on boot
- [x] WiFi: fallback to AP mode if no creds or connection fails
- [x] Firebase: init using `config.h` constants
- [x] Sensor: read raw ADC from GPIO 34 (zone 1) and GPIO 35 (zone 2)
- [x] Sensor: map raw ADC to `moisturePercent`, publish to Firebase
- [x] Relay: initialize both relays CLOSED (HIGH) on cold start
- [x] Relay: `openValve()` / `closeValve()` with safety cutoff
- [x] Firebase listener: subscribe to `command/action` for each zone
- [x] Firebase command handler: act, write back `valve/state`, clear `command/action`
- [x] `enforceValveSafety()`: force-close valve if open > `MAX_VALVE_MS`
- [x] Watchdog: restart ESP32 if Firebase unreachable > 5 minutes
- [x] Device heartbeat: `lastSeen`, `ipAddress`, `wifiRssi`, `firmware`, `sensorIntervalMs`, `heartbeatIntervalMs`, `maxValveMs`
- [x] All timing via `millis()` — no `delay()` in `loop()`

## M2 — Firmware: Schedules + Multi-zone ✅

- [x] Read all schedules from Firebase on boot
- [x] Reload schedule cache every 5 minutes
- [x] `checkSchedules()`: runs every minute, compares current time to entries
- [x] Trigger valve open/close if schedule matches, respect `enabled` flag
- [x] Duration tracking: closes valve after `durationMinutes`
- [x] NTP time sync on boot with timezone offset from `config.h`
- [x] Support both zones independently

## M3 — React PWA: Dashboard + Manual Control ✅

- [x] Scaffold Vite + React 18 in `pwa/`
- [x] Add `vite-plugin-pwa` + web manifest
- [x] Firebase JS SDK v9 (modular) init
- [x] `useZoneData` hook — `onValue()` subscriptions, unsubscribed on unmount
- [x] Dashboard view: moisture gauge, valve state, device online/offline, collapsible device details
- [x] Manual control view: OPEN/CLOSE per zone with confirmation dialog and duration picker
- [x] Manual control disabled when device is offline
- [x] Mobile-first layout
- [x] Guest mode: read-only access via anonymous sign-in

## M4 — React PWA: Schedule Editor ✅

- [x] Schedule view: list schedules per zone
- [x] Add / edit / delete schedule entries
- [x] Schedule editing disabled when device is offline
- [x] Write schedule changes to Firebase

## M5 — Settings + Runtime Config ✅

- [x] Settings page: controller rename, zone rename, sensor interval presets, sensor enable/disable per zone
- [x] Runtime sensor interval update — no reflash required (Firebase config stream + 10s poll fallback)
- [x] Sensor enable/disable from PWA — disables dashboard display and command polling for that zone
- [x] Device cards collapsible in Settings
- [x] Confirm tooltip before applying sensor interval change
- [x] Online/offline threshold derived from `heartbeatIntervalMs` (dynamic, not hardcoded)

## M6 — Hardening

- [x] Firebase security rules: device and app access restricted per path
- [x] `config/` read access added for device account (2026-06-17)
- [x] Zone and device names preserved on reflash (write-only-if-empty pattern)
- [x] Max valve time reduced to 3 minutes — updated in firmware and PWA
- [x] `lastChangedAt` uses Firebase server timestamp (not `millis()`)
- [x] Serial logging reduced — only meaningful events printed
- [ ] Low moisture alert: in-app notification or Telegram bot
- [ ] Sensor calibration for esp32-02 (requires physical sensors connected)
- [ ] Seasonal threshold review (4 weeks after first live data)

---

## Blocked / Needs Owner Action

| Item | Blocker |
|---|---|
| Sensor calibration esp32-02 (`DRY_RAW`, `WET_RAW`) | Must be measured from physical hardware after sensors wired |
| esp32-02 sensors connected | Hardware wiring not done yet |
| Clean up fake sensor/history data for esp32-02 | Requires admin account — delete via Firebase Console (`balcony2`, `garden2` → sensor + history nodes) |
| Low moisture alert threshold values | Owner decides per-zone thresholds before alert can be built |

---

## Next Actions

1. **Wire sensors to esp32-02** → measure calibration values, update `config.h` board 2 section, flip `ZONE_X_SENSOR_ENABLED` to 1, reflash
2. **Low moisture alert** — add in-app notification when moisture drops below configurable threshold (sensor data already flowing)
3. **Clean up esp32-02 fake data** — delete `sensor` and `history` nodes for `balcony2`/`garden2` in Firebase Console
