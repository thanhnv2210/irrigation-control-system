# Hardware Guide — Irrigation Control System

---

## Required Hardware

### Core

| Component | Specification | Qty | Notes |
|---|---|---|---|
| ESP32 DevKit V1 | 38-pin, ESP32-WROOM-32 | 1 | Must be ESP32 — not Arduino UNO or other AVR boards |
| Capacitive soil moisture sensor | v1.2 | 2 | Buy capacitive, NOT resistive — resistive corrodes quickly in soil |
| Relay module | 5V, single channel, active-LOW | 2 | One per zone |
| Solenoid valve | 12V DC | 2 | One per zone (balcony + garden) |
| 12V DC power adapter | 1A minimum | 1 | Powers solenoid valves |
| Buck converter / voltage regulator | AMS1117 3.3V or similar | 1 | Steps 12V down to 3.3V for ESP32 |
| Jumper wires | Male-to-male, male-to-female | 1 set | For prototyping |
| Breadboard | Full size | 1 | For prototyping before final wiring |

### USB Cable (for flashing)
- ESP32 DevKit V1 uses **Micro-USB**
- If your laptop only has USB-C, buy a **USB-A to USB-C adapter** (~$5) — do not buy a new board just for the cable

---

## What NOT to Buy

- **Generic Arduino starter kits** — they include components irrelevant to this project (LCD screens, buzzers, IR sensors) and usually don't include ESP32
- **Resistive soil moisture sensors** — they corrode in soil within weeks
- **Arduino UNO / MEGA / Nano** — these have no WiFi and cannot run Firebase

---

## GPIO Pin Assignment

| Component | GPIO Pin | Notes |
|---|---|---|
| Soil sensor 1 (balcony) | GPIO 34 | ADC1 — input only |
| Soil sensor 2 (garden) | GPIO 35 | ADC1 — input only |
| Relay 1 (balcony valve) | GPIO 26 | Active-LOW: HIGH = valve closed |
| Relay 2 (garden valve) | GPIO 27 | Active-LOW: HIGH = valve closed |
| Optional DHT22 (temp/humidity) | GPIO 4 | Not in MVP |

**Why GPIO 34 and 35?** These are ADC1 pins. ADC2 pins (GPIO 0, 2, 4, 12–15, 25–27) are shared with WiFi and give unreliable readings when WiFi is active.

---

## Wiring Overview

```
12V Adapter
    │
    ├─── (+) ──► Solenoid Valve 1 ──► Relay 1 COM/NO ──► GND
    ├─── (+) ──► Solenoid Valve 2 ──► Relay 2 COM/NO ──► GND
    └─── (+) ──► Buck Converter IN+ ──► OUT+ ──► ESP32 3.3V

ESP32
    ├─── GPIO 26 ──► Relay 1 IN
    ├─── GPIO 27 ──► Relay 2 IN
    ├─── GPIO 34 ──► Sensor 1 AOUT
    ├─── GPIO 35 ──► Sensor 2 AOUT
    ├─── 3.3V ──► Sensor 1 VCC, Sensor 2 VCC
    └─── GND ──► Sensor 1 GND, Sensor 2 GND, Relay 1 GND, Relay 2 GND
```

**Do not wire the relay before the board firmware is verified** — incorrect wiring with a live 12V supply can damage components.

---

## Soil Sensor Calibration

Calibration values must be measured from real hardware. Placeholder values are in `config.h` — replace them after measuring.

**Procedure:**
1. Flash firmware and open Serial Monitor at 115200 baud
2. Hold sensor in completely dry air/soil → note the `raw` value → this is `DRY_RAW`
3. Submerge sensor tip in water → note the `raw` value → this is `WET_RAW`
4. Update `config.h`:
   ```cpp
   #define DRY_RAW_1   <measured value>
   #define WET_RAW_1   <measured value>
   ```
5. Re-flash — moisture percentage will now be accurate

Typical values for capacitive v1.2: `DRY_RAW ≈ 3200`, `WET_RAW ≈ 1200` — but measure yours, they vary per unit.

---

## Safety Rules (Non-Negotiable)

1. **Always verify firmware works on the bench before connecting valves**
2. **Never test with water supply active until all wiring is confirmed correct**
3. **Max valve open time is 10 minutes** — enforced in firmware, do not reduce
4. **Valves default CLOSED on power-up** — relay pins initialize HIGH before any other code runs
