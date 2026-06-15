# Smart Irrigation Control System

**A full-stack IoT project built from scratch — ESP32 firmware, Firebase real-time backend, and a React PWA — controlling physical solenoid valves for a balcony and garden.**

---

## Overview

This project automates watering for two garden zones using a custom-built IoT stack. A physical ESP32 microcontroller reads soil moisture every 30 seconds, controls solenoid valves via relay modules, and stays in sync with a Firebase Realtime Database. A React Progressive Web App installed on a phone provides live monitoring, manual control, scheduling, and Telegram alerts — all without any custom backend server.

The system has been running in production on real plants since June 2026.

---

## The Problem

Manual watering of a balcony garden and outdoor garden bed is inconsistent — plants get overwatered some weeks and underwatered others. The goal was a reliable, phone-operable system that:

- Monitors real soil moisture (not just a timer)
- Allows manual override from anywhere
- Runs automated schedules
- Alerts when plants are dry or the device goes offline
- Is safe — a stuck-open valve for hours would flood a balcony

---

## Architecture

```
┌──────────────────┐         Firebase RTDB          ┌──────────────────┐
│   ESP32 Board    │ ◄──────────────────────────────► │   React PWA      │
│                  │                                  │ (mobile browser) │
│ • Reads moisture │   irrigation/sites/default/      │                  │
│ • Controls relay │     devices/esp32-01/            │ • Dashboard      │
│ • Heartbeat 60s  │       meta/          ← heartbeat │ • Manual control │
│ • Polls commands │       zones/balcony/ ← commands  │ • Schedules      │
│   every 3s       │         sensor/      → moisture  │ • Alerts         │
│ • Runs schedules │         valve/       ← state     │ • Statistics     │
└──────────────────┘         command/     ← app write └──────────────────┘
        │
        │ GPIO
        ▼
┌──────────────────┐
│  Capacitive soil │
│  moisture sensor │  × 2
│  (GPIO 34, 35)   │
└──────────────────┘
┌──────────────────┐
│  Active-LOW      │
│  relay module    │  × 2
│  (GPIO 26, 27)   │
└──────────────────┘
        │
        ▼
  Solenoid valve
```

**Key architectural decision:** No custom backend server. Firebase RTDB serves as both the config store and real-time command channel. The ESP32 and PWA communicate entirely through Firebase — the app writes a command, the firmware reads and acts on it, then clears it. This eliminates hosting costs and keeps the system simple.

---

## Hardware

| Component | Spec | Notes |
|---|---|---|
| MCU | ESP32-D0WD-V3 rev 3.1 (38-pin DevKit) | MAC: 1c:c3:ab:f9:ac:50 |
| Soil sensors | Capacitive v1.2 × 2 | GPIO 34 (balcony), GPIO 35 (garden) |
| Relays | 5V active-LOW single relay × 2 | GPIO 26 & 27 |
| Solenoid valves | 12V DC | Via relay 1 & 2 |
| Power | 12V adapter + AMS1117 buck to 3.3V | |

**Sensor calibration** (measured in real soil, June 2026):

| Sensor | Zone | DRY_RAW | WET_RAW |
|---|---|---|---|
| Sensor 1 | Balcony | 3158 | 1290 |
| Sensor 2 | Garden | 3115 | 1367 |

Raw ADC values (0–4095) are mapped to 0–100% moisture using the calibration values above.

---

## Firmware (Arduino C++ / ESP32)

**File:** `firmware/irrigation_main/irrigation_main.ino`

### Boot sequence

```
1. Initialize relay pins HIGH (valves CLOSED — hardware safety first)
2. Read WiFi credentials from flash (Preferences library)
3. If no credentials → start captive portal AP for provisioning
4. Connect to WiFi
5. Authenticate with Firebase (email/password)
6. Register device meta and zone meta to Firebase
7. Force all valves CLOSED + clear any stale pending commands
8. Sync Firebase valve state (prevents mismatch after restart)
9. Start sensor reads, heartbeat, schedules, NTP
10. Begin Firebase streams on command/action paths
```

### Main loop (millis-based, no blocking delays)

| Task | Interval |
|---|---|
| Enforce valve safety | Every iteration |
| Publish sensor readings | Every 30s |
| Poll `command/action` from Firebase | Every 3s |
| Heartbeat (lastSeen, RSSI, IP) | Every 60s |
| Check schedule triggers | Every 60s |
| Reload schedules from Firebase | Every 5 min |
| WiFi health check + reconnect | Every 30s |
| Firebase stream health check | Every 10s |
| Firebase watchdog | Every iteration |

### Command pattern

The PWA writes `command/action = "OPEN"` with a `durationSeconds` value. The firmware polls this path every 3 seconds, acts on the command (opens relay), then clears `command/action` to `null`. This prevents re-execution on restart.

### Safety rules (non-negotiable)

1. **Max valve open: 10 minutes (600,000ms)** — hard cutoff enforced in firmware regardless of any command or schedule
2. **Cold start: all valves CLOSED** — relay pins initialized HIGH before any other code runs
3. **WiFi loss: hold last valve state** — do not open or close on reconnect
4. **Firebase loss: hold last valve state** — watchdog reboots after 5 minutes of no Firebase contact

### WiFi provisioning

On first boot (no credentials in flash), the ESP32 broadcasts an AP (`ESP32_Config`) and serves a captive portal web form. The user connects from their phone, enters WiFi credentials, and the board saves them to flash and reboots. No hardcoded WiFi credentials in source code.

### Diagnostic snapshot

When the device reconnects after going offline, it writes a diagnostic record to Firebase:

```json
{
  "reason": "wifi_reconnected",
  "offlineSec": 47,
  "wifiRssi": -68,
  "freeHeap": 160384,
  "uptimeSec": 3620,
  "timestamp": 1781526406758
}
```

This is visible in the PWA dashboard and included in Telegram "back online" alerts, making it possible to diagnose disconnects without a Serial Monitor.

---

## Firebase Schema

```
irrigation/
  sites/
    default/
      devices/
        esp32-01/
          meta/           ← heartbeat (firmware writes)
            name
            firmware
            lastSeen
            ipAddress
            wifiRssi
            lastDiagnostic/
          zones/
            balcony/
              meta/       ← zone config
              sensor/     ← live moisture (firmware writes every 30s)
              valve/      ← current state (firmware writes after acting)
              command/    ← app writes here, firmware clears after acting
              schedule/   ← app writes, firmware reads
              history/    ← time-series moisture readings
            garden/
              ...
        esp32-02/
          ...             ← second board, fully isolated
      settings/
        alerts/           ← Telegram credentials + thresholds
      auditLog/           ← all valve commands logged
```

**Multi-board isolation:** Each ESP32 owns its zones under `devices/{device_id}/zones/`. Two boards can run simultaneously with zero path conflicts.

---

## React PWA

**Stack:** React 18 + Vite + Firebase JS SDK v9 (modular) + vite-plugin-pwa

**Deployed at:** `https://irrigation.thanhnguyen.dev/`

### Views

**Dashboard**
- Live moisture gauge per zone (color-coded: red < 30%, amber 30–60%, green ≥ 60%)
- Valve state badge (OPEN / CLOSED) with last-changed time
- Device status row: online/offline indicator, IP, RSSI, last seen
- Diagnostic info in amber when a disconnect has occurred

**Control**
- Manual valve open with confirmation dialog (prevents accidental activation)
- Duration picker: 30s to 9 minutes in 30-second steps
- Live pending command banner while device is acting

**Schedule**
- Add/edit/delete schedules per zone (hour, minute, duration, days of week)
- Enable/disable individual schedules
- Writes directly to Firebase; firmware reloads every 5 minutes

**Statistics**
- Line chart of moisture history (4h / 8h / 24h or by date)
- Watering events shown as green shaded bands
- Min / max / average / current stats per zone

**Alerts**
- Telegram bot integration: token + chat ID
- Per-zone moisture threshold alerts (configurable, 1-hour cooldown)
- Device offline alert with configurable threshold (minimum 5 minutes)
- 2-strike hysteresis before alerting — prevents SSL blip false alarms
- "Back online" message includes disconnect reason, duration, RSSI

**Settings**
- Site management (create, rename, delete sites)
- Zone rename (inline edit on dashboard)
- Device rename (inline edit on dashboard)

### Real-time data

All Firebase reads use `onValue()` subscriptions — data updates instantly without polling or page refresh. The PWA works as a PWA installable on iOS/Android home screen.

---

## Key Engineering Challenges Solved

### 1. SSL stream instability on ESP32
The FirebaseESP32 library's streaming connection drops with SSL errors every 1–2 minutes on some networks. Stream callbacks don't re-deliver the current value on reconnect, causing valve commands to be silently missed.

**Solution:** Added `pollCommand()` — a direct `Firebase.getString()` read on `command/action` every 3 seconds, running independently of stream health. Commands are now reliably picked up within 3 seconds regardless of stream state.

### 2. Multi-board zone conflicts
Two ESP32 boards initially shared a flat zone namespace (`sites/default/zones/balcony`). Board 2 would overwrite Board 1's zone metadata, causing the wrong zones to appear under the wrong device in the PWA.

**Solution:** Restructured Firebase schema to nest zones under their device (`devices/{device_id}/zones/{zone_id}`). Each board is fully isolated. SiteContext now derives the zone list by iterating devices → zones, preserving the device association for all path operations.

### 3. Security rules blocking device reads
After the schema restructure, the device UID had write permission on zones but the read rule wasn't updated. The firmware's `pollCommand()` returned "Permission denied" on every poll — silently blocking all valve commands.

**Solution:** Systematic debugging with verbose Serial logging showing the exact Firebase path being polled and the exact error reason. Identified the rules mismatch, deployed updated `database.rules.json`.

### 4. Offline alert spam
The Telegram alert monitor was firing "Device Offline" and "Back Online" messages in rapid succession during transient SSL drops (which recover in under 90 seconds).

**Solution:** Added 2-strike consecutive-miss requirement before alerting offline. Added cooldown to the "back online" message (was previously uncooldown-limited). Raised minimum offline threshold to 5 minutes in the UI.

### 5. Stale valve state after reboot
After a restart, the firmware's internal `valveOpen = false` state conflicted with Firebase showing `OPEN` from before the reboot. The `closeValve()` function returned early because it thought the valve was already closed, leaving the physical relay and Firebase out of sync.

**Solution:** Boot sequence unconditionally sets relay pins HIGH and writes `CLOSED` to Firebase for all zones, regardless of internal state. Any pending commands are also cleared to prevent re-execution.

---

## Security

- WiFi credentials stored in ESP32 flash via `Preferences` — never in source code
- Firebase credentials in `config.h` (gitignored) — not committed
- Firebase security rules restrict each path: device UID can only write sensor/valve/command data; owners write schedules and settings; device cannot write schedules
- PWA has no public access — Firebase rules block all unauthenticated reads/writes

---

## Project Timeline

| Date | Milestone |
|---|---|
| 2026-06-07 | Project design, schema design, firmware architecture |
| 2026-06-13 | First hardware setup, first successful Firebase connection, sensor calibration |
| 2026-06-14 | Relay control working, PWA dashboard live, multi-board onboarding |
| 2026-06-15 | Schema restructure (zones under devices), valve control debugging, Telegram alerts |
| 2026-06-15 | Diagnostic snapshot on reconnect, offline alert spam fix |
| 2026-06-16 | Firmware v1.0.1 deployed, PWA deployed to production |

---

## What I Learned

**Hardware and firmware integration is harder than software.** The gap between "works in simulation" and "works with real hardware" involved: WiFi band mismatches (5GHz vs 2.4GHz), SSL library instability, relay active-LOW logic, ADC calibration in real soil, and timing issues around reboot state synchronization.

**Firebase as a command channel requires careful protocol design.** The write-then-clear pattern (`command/action → null`) prevents re-execution on restart but requires the firmware to act atomically — read, act, clear — without any gap where a second read could re-trigger.

**Observability is essential in IoT.** The most valuable additions to this project were verbose Serial logging with exact Firebase paths and error reasons, and the diagnostic snapshot written to Firebase on reconnect. Without these, debugging "why did the valve not open" would have been guesswork.

**Schema design affects everything downstream.** Restructuring from flat `zones/` to `devices/{id}/zones/` required updating firmware path helpers, 8 PWA files, security rules, and migrating Firebase data — all of which needed to happen atomically or the system breaks in confusing ways.
