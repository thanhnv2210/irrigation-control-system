# Sensor Verification Guide

Verify both soil moisture sensors are reading correctly before testing the relay and motor.

---

## Prerequisites

- Firmware flashed and running (`irrigation_main.ino`)
- ESP32 connected to WiFi and Firebase
- Arduino IDE Serial Monitor open at baud `115200`
- Two capacitive soil moisture sensors wired:
  - Sensor 1 (balcony) → GPIO 34
  - Sensor 2 (garden) → GPIO 35
  - Both VCC → 3.3V, GND → GND

---

## Calibration Values (measured 2026-06-13)

| | DRY_RAW | WET_RAW |
|---|---|---|
| Sensor 1 (balcony, GPIO 34) | 3158 | 1290 |
| Sensor 2 (garden, GPIO 35) | 3115 | 1367 |

---

## Step 1 — Dry Air Test

1. Hold both sensors in open air (not touching soil, water, or any surface)
2. Watch Serial Monitor — readings publish every 30 seconds
3. Press **EN/RST** to force an immediate read on boot

**Expected output:**
```
[Zone balcony] Moisture: 0% (raw ~3150)
[Zone garden]  Moisture: 0% (raw ~3115)
```

**Pass criteria:** Both sensors read 0–5% in dry air. Values above 10% indicate the sensor tip is touching something or the calibration needs adjustment.

---

## Step 2 — Wet Test

1. Dip the sensor tip (not the electronics) into a glass of water
2. Wait 5 seconds for reading to stabilize
3. Check Serial Monitor

**Expected output:**
```
[Zone balcony] Moisture: 95–100% (raw ~1290–1350)
[Zone garden]  Moisture: 95–100% (raw ~1367–1430)
```

**Pass criteria:** Both sensors read 90–100% when submerged. Values below 80% suggest the `WET_RAW` calibration value needs to be lowered in `config.h`.

---

## Step 3 — Soil Test

1. Insert sensors into actual soil at the balcony / garden location
2. Wait for 2–3 readings (60–90 seconds)
3. Verify values are in a realistic range

**Expected range for typical soil:**
- Dry soil: 10–30%
- Moist soil: 40–70%
- Saturated soil: 80–100%

---

## Step 4 — Firebase Verification

1. Open Firebase console → RTDB
2. Navigate to `irrigation/sites/default/zones/balcony/sensor`
3. Confirm these fields are updating every 30 seconds:
   - `moisturePercent` — number 0–100
   - `rawValue` — raw ADC reading
   - `timestamp` — recent Unix timestamp (ms)
4. Repeat for `zones/garden/sensor`

---

## Step 5 — PWA Verification

1. Open the PWA dashboard
2. Confirm both zone cards show the moisture gauge updating
3. Verify the percentage matches what Serial Monitor shows

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Moisture stuck at 0% (raw 0) | Sensor not wired / loose connection | Check VCC, GND, signal wire on GPIO 34/35 |
| Moisture stuck at 100% | Signal wire shorted to GND | Inspect wiring |
| Reading jumps erratically | Poor contact / damaged sensor | Reseat connectors; replace sensor |
| Dry air reads 20%+ | `DRY_RAW` too low | Increase `DRY_RAW` in `config.h`, re-flash |
| Wet reads below 80% | `WET_RAW` too high | Decrease `WET_RAW` in `config.h`, re-flash |
| Data not in Firebase | WiFi/Firebase disconnected | Check Serial Monitor for connection errors |

---

## Sign-off

Once both sensors pass all 5 steps, proceed to **relay and motor testing**.

| Check | Result | Date |
|---|---|---|
| Sensor 1 dry air (0–5%) | | |
| Sensor 2 dry air (0–5%) | | |
| Sensor 1 wet (90–100%) | | |
| Sensor 2 wet (90–100%) | | |
| Firebase data updating | | |
| PWA gauge updating | | |
