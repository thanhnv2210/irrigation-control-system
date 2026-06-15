# Irrigation Control System — Docs

A smart irrigation system for balcony and garden zones — ESP32 firmware, Firebase RTDB, and a React PWA deployed at **[irrigation.thanhnguyen.dev](https://irrigation.thanhnguyen.dev/)**.

---

## Start Here

Follow these guides in order if setting up from scratch:

### 1. [Hardware Guide](hardware-guide.md)
What to buy, wiring overview, GPIO pin assignment, and sensor calibration procedure.

### 2. [Firebase Setup](firebase-setup.md)
Firebase project details, how auth accounts were created, RTDB schema, security rules, and how to recreate everything from scratch.

### 3. [Arduino IDE Setup](arduino-ide-setup.md)
Install Arduino IDE 2.x, add ESP32 board support, install FirebaseESP32 library, compile and flash the firmware, and first-boot WiFi provisioning.

### 4. [Flashing on Windows](flashing-windows.md)
Windows-specific guide for flashing the ESP32 — USB driver installation and COM port setup.

### 5. [Postman Device Simulator](postman-simulator.md)
How to use the Postman collection to simulate ESP32 behavior against Firebase while waiting for hardware.

---

## Quick Reference

| Task | Guide |
|---|---|
| What hardware to buy | [hardware-guide.md](hardware-guide.md) |
| Wiring the board | [hardware-guide.md](hardware-guide.md#wiring-overview) |
| Calibrating soil sensors | [hardware-guide.md](hardware-guide.md#soil-sensor-calibration) |
| Firebase credentials and UIDs | [firebase-setup.md](firebase-setup.md) |
| Recreating Firebase from scratch | [firebase-setup.md](firebase-setup.md#5-recreating-everything-from-scratch) |
| Installing Arduino IDE + ESP32 package | [arduino-ide-setup.md](arduino-ide-setup.md) |
| Upload failing / BOOT button | [arduino-ide-setup.md](arduino-ide-setup.md#if-upload-hangs-at-connecting) |
| First boot WiFi setup | [arduino-ide-setup.md](arduino-ide-setup.md#10-first-boot--wifi-provisioning) |
| Flashing from Windows | [flashing-windows.md](flashing-windows.md) |
| Simulating device with Postman | [postman-simulator.md](postman-simulator.md) |
| First device setup log | [first-device-setup-2026-06-13.md](first-device-setup-2026-06-13.md) |
| Sensor verification steps | [sensor-verification.md](sensor-verification.md) |
| Relay control debugging | [relay-control-debugging-2026-06-14.md](relay-control-debugging-2026-06-14.md) |
| Valve control debugging | [valve-control-debugging-2026-06-15.md](valve-control-debugging-2026-06-15.md) |
| Guest access / view-only mode | [guest-access.md](guest-access.md) |
| Portfolio / project overview | [portfolio.md](portfolio.md) |

---

## Repository Structure

```
irrigation-control-system/
├── firmware/
│   ├── irrigation_main/
│   │   ├── irrigation_main.ino   — production firmware v1.0.1
│   │   ├── config.h              — credentials + device IDs (gitignored)
│   │   └── config.h.example      — template with placeholder values
│   ├── esp_32_auto_config_v1/    — WiFi provisioning sketch (reference)
│   ├── elb_peripheral_v1/        — TCP + Firebase prototype (reference)
│   └── Firebase_Sample_2/        — FirebaseESP32 library sample (reference)
├── pwa/                          — React PWA (deployed to irrigation.thanhnguyen.dev)
│   ├── src/
│   │   ├── firebase.js           — Firebase init
│   │   ├── context/SiteContext.jsx — multi-site state + path helper
│   │   ├── hooks/
│   │   │   ├── useZoneData.js    — real-time zone + device subscriptions
│   │   │   ├── useHistory.js     — sensor history for Statistics
│   │   │   └── useAlertMonitor.js — Telegram alert trigger
│   │   ├── views/
│   │   │   ├── Dashboard.jsx     — moisture gauges + device status + diagnostic
│   │   │   ├── Control.jsx       — manual valve open/close with duration picker
│   │   │   ├── Schedule.jsx      — schedule editor per zone
│   │   │   ├── Statistics.jsx    — moisture history chart
│   │   │   ├── MapView.jsx       — drag-and-drop zone pins on garden SVG
│   │   │   ├── Alerts.jsx        — Telegram + offline alert config
│   │   │   ├── AuditLog.jsx      — valve/schedule event history
│   │   │   ├── Simulator.jsx     — device simulator for testing without hardware
│   │   │   └── Settings.jsx      — site management + user profile
│   │   ├── components/
│   │   │   └── ConfirmDialog.jsx — valve open confirmation modal
│   │   └── utils/audit.js        — audit log writer
│   ├── package.json
│   └── vite.config.js
├── docs/
│   ├── README.md                         — this file
│   ├── portfolio.md                      — comprehensive project overview
│   ├── hardware-guide.md
│   ├── firebase-setup.md
│   ├── arduino-ide-setup.md
│   ├── flashing-windows.md
│   ├── postman-simulator.md
│   ├── sensor-verification.md
│   ├── first-device-setup-2026-06-13.md
│   ├── relay-control-debugging-2026-06-14.md
│   ├── valve-control-debugging-2026-06-15.md
│   └── device-onboarding-flow.puml
├── database.rules.json       — Firebase RTDB security rules
├── firebase.json             — Firebase CLI deploy config
├── CLAUDE.md                 — project brief for Claude Code
└── .gitignore
```

---

## Milestone Status

| Milestone | Status |
|---|---|
| M1 — Firmware: Core Loop | ✅ Complete — running in production on esp32-01 |
| M2 — Firmware: Schedules + Multi-zone | ✅ Complete — schedule execution verified |
| M3 — React PWA: Dashboard + Manual Control | ✅ Complete — deployed, valve control working |
| M4 — React PWA: Schedule Editor | ✅ Complete — deployed |
| M5 — Hardening | 🔄 In progress — security rules deployed, Telegram alerts live, esp32-02 onboarding pending |

---

## Devices in Production

| Device ID | Zones | Firmware | Status |
|---|---|---|---|
| `esp32-01` | balcony, garden | v1.0.1 | Online |
| `esp32-02` | balcony2, garden2 | v1.0.0 | Pending onboarding |

---

## Deployment Checklist

After any firmware or schema change, follow this order:

1. Update `database.rules.json` if paths changed
2. Deploy rules: `firebase deploy --only database --project smarthomeapp-982da`
3. Update firmware path helpers (`zonePath`, `devicePath`) in `irrigation_main.ino`
4. Update all PWA files that reference Firebase paths
5. Flash all boards (each board must be on the same schema version)
6. Clear any stuck commands: `firebase database:remove --project smarthomeapp-982da "/irrigation/sites/default/devices/esp32-01/zones/<zone>/command"`
7. Build and deploy PWA: `cd pwa && npm run build && firebase deploy --only hosting`
8. Verify on Serial Monitor: confirm poll paths, heartbeat, and firmware version
9. Verify on Firebase: `firebase database:get --project smarthomeapp-982da "/irrigation/sites/default/devices/esp32-01/meta"`
