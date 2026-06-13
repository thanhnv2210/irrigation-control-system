# First Device Setup — 2026-06-13

Session log for the first successful ESP32 firmware flash and Firebase connection.

---

## Hardware

- **Board:** ESP32-D0WD-V3 (revision 3.1), 38-pin DevKit
- **MAC:** `1c:c3:ab:f9:ac:50`
- **Cable:** Micro-USB data cable (not charge-only)

---

## Steps

### 1. Verify cable supports data transfer
- Plug ESP32 into Mac via Micro-USB cable
- Open Arduino IDE → **Tools → Port**
- Port `/dev/cu.usbserial-0001` appeared — confirmed data cable

### 2. Flash firmware
- Arduino IDE → **Tools → Board** → `ESP32 Dev Module`
- **Tools → Port** → `/dev/cu.usbserial-0001`
- Open `firmware/irrigation_main/irrigation_main.ino`
- Click **Upload**
- Result: 1,283,968 bytes written, hash verified, board hard-reset automatically

### 3. Open Serial Monitor
- **Tools → Serial Monitor**, baud rate `115200`
- No output visible initially — pressed **EN/RST** button on board to replay boot logs
- Log showed board booted into **AP mode** (expected — no WiFi credentials saved yet)

### 4. WiFi provisioning — first attempt (failed)
- Connected phone to `ESP32_Config` (password: `123456789`)
- Opened browser → `192.168.4.1`
- Entered SSID `SINGTEL-H4VA` + password → submitted
- Board rebooted and failed to connect: **status code 6 (WL_DISCONNECTED)**
- Root cause: `SINGTEL-H4VA` is the 5GHz band — ESP32 only supports 2.4GHz

### 5. Added WiFi diagnostic logging
- Updated `firmware/irrigation_main/irrigation_main.ino` to log WiFi status code after timeout
- Status codes: `1` = SSID not found, `4` = wrong password, `6` = disconnected/band mismatch
- Re-flashed firmware

### 6. WiFi provisioning — second attempt (successful)
- Found the 2.4GHz network: **`SINGTEL-WNP6`** (separate SSID from 5GHz `SINGTEL-H4VA`)
- Re-provisioned via `192.168.4.1` with `SINGTEL-WNP6` credentials
- Board connected successfully, assigned IP: `192.168.1.9`

### 7. Firebase connection
- Firebase auth token obtained (GITKit token, status: ready)
- Sensor data published to `irrigation/sites/{SITE_ID}/zones/balcony/sensor`
- Schedules loaded (10 entries per zone — pre-existing test data)
- Data confirmed live in Firebase console

---

## Issues & Resolutions

| Issue | Cause | Resolution |
|---|---|---|
| Serial Monitor showed no output | Missed boot output before monitor opened | Press EN/RST button to replay boot |
| WiFi connection failed (status 6) | ESP32 tried to connect to 5GHz band | Use 2.4GHz SSID (`SINGTEL-WNP6`) |
| Moisture showing 100% (raw 0) | No sensors wired yet | Expected — will resolve after wiring |
| NTP sync failed | Router may block external NTP | Non-critical — to fix before schedules are used |

---

## Current State

- Firmware flashed and running
- WiFi credentials saved to flash (survives reboot)
- Firebase auth and data publishing working
- Sensors not yet wired — raw ADC reads 0
- Relays not yet wired — untested
- NTP time sync failing — schedules will not fire

---

## Next Steps

1. Wire soil sensors (GPIO 34, 35) and calibrate (`DRY_RAW`, `WET_RAW`)
2. Wire relays (GPIO 26, 27) and test via Firebase command
3. Fix NTP sync
4. Test manual valve control via Firebase console and PWA
