# Smart Irrigation Control System

A full-stack IoT system that automates watering for balcony and garden zones. An ESP32 reads soil moisture every 30 seconds and controls solenoid valves via relays. A React PWA installed on a phone provides live monitoring, manual control, scheduling, and Telegram alerts — all backed by Firebase Realtime Database with no custom server.

**Live PWA:** [irrigation.thanhnguyen.dev](https://irrigation.thanhnguyen.dev/)

![System Architecture](https://img.shields.io/badge/ESP32-Firmware-blue) ![Firebase](https://img.shields.io/badge/Firebase-RTDB-orange) ![React](https://img.shields.io/badge/React-PWA-61dafb) ![Status](https://img.shields.io/badge/Status-Production-green)

---

## How It Works

```
Phone (PWA) ──── Firebase RTDB ──── ESP32 Board
                      │                  │
              writes command/OPEN    polls every 3s
              reads sensor data      acts on relay
              reads valve state      clears command
                      │                  │
                  real-time         GPIO 26/27
                  push to PWA       relay → valve
```

The app writes a command to Firebase. The firmware polls it every 3 seconds, opens the relay, then clears the command. Sensor readings flow back the other way every 30 seconds.

---

## Features

- **Live soil moisture** — capacitive sensors, 0–100% mapped from calibrated ADC values
- **Manual valve control** — open/close from phone with duration picker (30s – 9 min)
- **Schedules** — per-zone watering schedules with day-of-week selection
- **Moisture history** — line charts with irrigation event overlays (4h / 8h / 24h / by date)
- **Telegram alerts** — low moisture and device offline notifications with 1-hour cooldown
- **Diagnostic snapshots** — disconnect reason, offline duration, RSSI written to Firebase on reconnect
- **Multi-board support** — zones isolated under each device, no cross-board conflicts
- **Safety cutoff** — firmware enforces 10-minute maximum valve open time, hardware first

---

## Stack

| Layer | Technology |
|---|---|
| Firmware | Arduino C++ (ESP32), FirebaseESP32 library |
| Database | Firebase Realtime Database |
| Auth | Firebase Email/Password |
| Frontend | React 18 + Vite, Firebase JS SDK v9 |
| PWA | vite-plugin-pwa |
| Hosting | Vercel |
| Alerts | Telegram Bot API |

---

## Hardware

| Component | Details |
|---|---|
| MCU | ESP32-D0WD-V3 (38-pin DevKit) |
| Soil sensors | Capacitive v1.2 × 2 (GPIO 34, 35) |
| Relays | 5V active-LOW × 2 (GPIO 26, 27) |
| Valves | 12V DC solenoid |
| Power | 12V adapter + AMS1117 3.3V buck |

---

## Repository Structure

```
irrigation-control-system/
├── firmware/
│   └── irrigation_main/
│       ├── irrigation_main.ino   — production firmware (v1.0.1)
│       ├── config.h              — credentials + pin config (gitignored)
│       └── config.h.example      — template to copy and fill in
├── pwa/                          — React PWA source
│   └── src/
│       ├── context/SiteContext.jsx
│       ├── hooks/                — useZoneData, useHistory, useAlertMonitor
│       └── views/                — Dashboard, Control, Schedule, Statistics, Alerts...
├── docs/                         — setup guides and session logs
│   ├── portfolio.md              — full project write-up
│   ├── hardware-guide.md
│   ├── firebase-setup.md
│   ├── arduino-ide-setup.md
│   └── ...
├── database.rules.json           — Firebase security rules
└── firebase.json                 — Firebase CLI config
```

---

## Getting Started

### Prerequisites

- Arduino IDE 2.x with ESP32 board support installed
- Firebase project (see [docs/firebase-setup.md](docs/firebase-setup.md))
- Node.js 18+ for the PWA

### 1. Firmware

```bash
# Copy config template and fill in your values
cp firmware/irrigation_main/config.h.example firmware/irrigation_main/config.h
```

Edit `config.h` with your Firebase credentials, device ID, zone IDs, and GPIO pins. Flash via Arduino IDE. On first boot the ESP32 starts a WiFi provisioning AP (`ESP32_Config`) — connect from your phone and enter your WiFi credentials.

See [docs/arduino-ide-setup.md](docs/arduino-ide-setup.md) for full setup steps.

### 2. Firebase Security Rules

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only database --project <your-project-id>
```

### 3. PWA

```bash
cd pwa
npm install
cp .env.example .env       # fill in test credentials if needed
npm run dev                # local dev
npm run build              # production build
```

---

## Firebase Data Schema

```
irrigation/sites/{site_id}/
  devices/{device_id}/
    meta/                  ← heartbeat (lastSeen, RSSI, IP, firmware, diagnostic)
    zones/{zone_id}/
      sensor/              ← live moisture (firmware writes every 30s)
      valve/               ← current state (OPEN/CLOSED)
      command/             ← app writes here, firmware clears after acting
      schedule/            ← app writes, firmware reads every 5 min
      history/             ← time-series sensor readings
  settings/alerts/         ← Telegram config + thresholds
  auditLog/                ← all valve commands with timestamp
```

Each ESP32 owns its zones under `devices/{device_id}` — multiple boards have fully isolated namespaces.

---

## Safety Design

The firmware enforces these rules regardless of any command from the app or schedule:

1. **Relay pins initialize HIGH (CLOSED) before any code runs** — safe cold start
2. **Max valve open: 10 minutes** — hard cutoff, cannot be overridden via Firebase
3. **On reboot: all valves forced CLOSED**, stale commands cleared, Firebase synced
4. **WiFi/Firebase loss: hold last valve state** — no change on reconnect
5. **Firebase watchdog: reboot after 5 minutes unreachable** — self-healing

---

## Key Engineering Decisions

**No custom backend server** — Firebase RTDB serves as both config store and real-time command channel. Eliminates hosting costs and complexity.

**Poll + stream dual approach** — FirebaseESP32 streams drop with SSL errors every 1–2 minutes on some networks. A direct `getString()` poll every 3 seconds runs independently of stream health, ensuring commands are always picked up within 3 seconds.

**Zones nested under devices** — prevents namespace conflicts when running multiple ESP32 boards simultaneously. Each board owns its zones at `devices/{device_id}/zones/`.

---

## Docs

| Document | Description |
|---|---|
| [docs/portfolio.md](docs/portfolio.md) | Full project write-up with architecture, challenges, and lessons learned |
| [docs/hardware-guide.md](docs/hardware-guide.md) | Wiring, GPIO assignments, sensor calibration |
| [docs/firebase-setup.md](docs/firebase-setup.md) | Firebase project setup, auth, security rules |
| [docs/arduino-ide-setup.md](docs/arduino-ide-setup.md) | Firmware setup and flashing |
| [docs/sensor-verification.md](docs/sensor-verification.md) | Sensor calibration and verification procedure |
| [docs/valve-control-debugging-2026-06-15.md](docs/valve-control-debugging-2026-06-15.md) | Debugging session — command flow and security rules |

---

## License

Personal project — not licensed for redistribution.
