# Irrigation Control System — TODO

Last reviewed: 2026-06-07

---

## Current Repository State

| Item | Status |
|---|---|
| `firmware/esp_32_auto_config_v1/` | Working — WiFi captive portal, Preferences flash storage |
| `firmware/elb_peripheral_v1/` | Proof of concept only — reference only |
| `firmware/Firebase_Sample_2/` | Reference only |
| `firmware/irrigation_main/` | Complete — M1 done, pending physical hardware |
| `config.h` | Created with device credentials |
| Firebase `irrigation/` path | Seeded with test data |
| Firebase security rules | Deployed |
| React PWA | Complete — Dashboard, Control, Schedule views |
| Hardware | NOT ASSEMBLED — ESP32 38-pin DevKit ordered |

---

## M1 — Firmware: Core Loop ✅

- [x] Create `irrigation_main/` sketch directory and `irrigation_main.ino`
- [x] Create `config.h.example` with all placeholder values
- [x] WiFi: read SSID/password from `Preferences` flash on boot
- [x] WiFi: fallback to AP mode if no creds or connection fails
- [x] Firebase: init using `config.h` constants
- [x] Sensor: read raw ADC from GPIO 34 (zone 1) and GPIO 35 (zone 2) every 30s
- [x] Sensor: map raw ADC to `moisturePercent`, publish to Firebase
- [x] Relay: initialize both relays CLOSED (HIGH) on cold start
- [x] Relay: `openValve()` / `closeValve()` with 10-minute safety cutoff
- [x] Firebase listener: subscribe to `command/action` for each zone
- [x] Firebase command handler: act, write back `valve/state`, clear `command/action`
- [x] `enforceValveSafety()`: force-close valve if open > `MAX_VALVE_MS`
- [x] Watchdog: restart ESP32 if Firebase unreachable > 5 minutes
- [x] Device heartbeat: `lastSeen`, `ipAddress`, `wifiRssi`, `firmware`
- [x] All timing via `millis()` — no `delay()` in `loop()`

## M2 — Firmware: Schedules + Multi-zone

- [ ] Read all schedules from Firebase on boot
- [ ] Listen for schedule changes in Firebase (update local cache)
- [ ] `checkSchedules()`: runs every minute, compares current time to entries
- [ ] Trigger valve open/close if schedule matches, respect `enabled` flag
- [ ] Support both zones independently

## M3 — React PWA: Dashboard + Manual Control ✅

- [x] Scaffold Vite + React 18 in `pwa/`
- [x] Add `vite-plugin-pwa` + web manifest
- [x] Firebase JS SDK v9 (modular) init
- [x] `useZoneData` hook — `onValue()` subscriptions, unsubscribed on unmount
- [x] Dashboard view: moisture gauge, valve state, device last seen / online indicator
- [x] Manual control view: OPEN/CLOSE per zone with confirmation dialog
- [x] Manual control writes to `command/` path only
- [x] Mobile-first layout

## M4 — React PWA: Schedule Editor ✅

- [x] Schedule view: list schedules per zone
- [x] Add / edit / delete schedule entries
- [x] Write schedule changes to Firebase

## M5 — Hardening

- [x] Firebase security rules: device and app access restricted per path
- [ ] Low moisture alert: in-app notification or Telegram bot
- [ ] Seasonal threshold review (4 weeks after first live data)

---

## Blocked / Needs Owner Action

| Item | Blocker |
|---|---|
| Sensor calibration values (`DRY_RAW`, `WET_RAW`) | Must be measured from physical hardware |
| `MAX_VALVE_MS` confirmation | Physical safety decision — owner to confirm 600,000 ms |
| Hardware assembly and wiring | ESP32 38-pin DevKit ordered — assemble on arrival |
| First live flash and valve test | Do not test with water supply until wiring is verified |
| Fill in Firebase password in `config.h` | Owner action |

---

## Next Actions

1. **M2 — Schedule firmware logic** (can do now, no hardware needed)
2. **Hardware arrives** → assemble, flash, calibrate sensors, verify Serial Monitor output
3. **M5** — low moisture alert after live data is flowing
