# Irrigation Control System — Docs

Step-by-step guides for setting up and running the system.

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
How to use the Postman collection to simulate ESP32 behavior against Firebase while waiting for hardware. Covers all test scenarios — boot sequence, manual valve control, schedule trigger, dry soil alert.

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
| Test scenarios (valve, schedule, dry soil) | [postman-simulator.md](postman-simulator.md#common-test-scenarios) |

---

## Repository Structure

```
irrigation-control-system/
├── firmware/
│   ├── irrigation_main/
│   │   ├── irrigation_main.ino   — production firmware (M1 complete)
│   │   ├── config.h              — credentials (gitignored, never commit)
│   │   └── config.h.example      — template with placeholder values
│   ├── esp_32_auto_config_v1/    — WiFi provisioning sketch (reference)
│   ├── elb_peripheral_v1/        — TCP + Firebase prototype (reference)
│   └── Firebase_Sample_2/        — FirebaseESP32 library sample (reference)
├── pwa/
│   ├── src/
│   │   ├── firebase.js           — Firebase init
│   │   ├── hooks/useZoneData.js  — real-time Firebase hooks
│   │   ├── views/                — Dashboard, Control, Schedule
│   │   └── components/           — ConfirmDialog
│   ├── package.json
│   └── vite.config.js
├── docs/
│   ├── README.md             — this file
│   ├── hardware-guide.md
│   ├── firebase-setup.md
│   ├── arduino-ide-setup.md
│   └── flashing-windows.md
├── database.rules.json       — Firebase RTDB security rules
├── firebase.json             — Firebase CLI deploy config
├── TODO.md                   — milestone progress tracker
├── CLAUDE.md                 — project brief for Claude Code
└── .gitignore
```

---

## Milestone Status

| Milestone | Status |
|---|---|
| M1 — Firmware: Core Loop | Complete — pending hardware for physical verification |
| M2 — Firmware: Schedules + Multi-zone | Not started |
| M3 — React PWA: Dashboard + Manual Control | Complete — pending hardware for live data |
| M4 — React PWA: Schedule Editor | Complete — pending hardware for live data |
| M5 — Hardening | Security rules deployed — alerts and seasonal review pending |
