# Arduino IDE Setup — ESP32 Firmware

Covers installing Arduino IDE 2.x, adding ESP32 board support, and installing required libraries.
Applies to both Mac and Windows.

---

## 1. Install Arduino IDE

Download **Arduino IDE 2.x** from arduino.cc and install it.

Tested with: **Arduino IDE 2.3.9**

---

## 2. Add ESP32 Board Support

### 2a. Add the board URL
**Arduino IDE > Preferences** (Mac: `Cmd + ,` / Windows: `Ctrl + ,`)

Paste into **"Additional boards manager URLs"**:
```
https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
```
Click OK.

> If this URL fails to load (proxy/firewall), try the mirror:
> ```
> https://espressif.github.io/arduino-esp32/package_esp32_index.json
> ```

### 2b. Install the package
Click the **board icon** in the left sidebar → search `esp32` → install **esp32 by Espressif Systems**.

Download is ~200MB. Wait for "INSTALLED" to appear.

> **Important:** Install "esp32 by Espressif Systems" — not "Arduino ESP32 Boards" by Arduino.

---

## 3. Install the FirebaseESP32 Library

Click the **library icon** in the left sidebar (or **Tools > Manage Libraries**) → search `FirebaseESP32` → install **Firebase ESP32 Client by Mobizt**.

If prompted *"Would you like to install dependencies?"* → click **Install All**.

---

## 4. Install USB Driver (Windows only)

ESP32 DevKit V1 uses a CH340 or CP2102 USB-to-serial chip. Windows needs a driver:

- **CH340:** search "CH340 driver Windows" → install from wch.cn
- **CP2102:** search "CP2102 driver" → install from Silicon Labs site

After installing, plug in the board — Device Manager should show a COM port (e.g. `COM3`).

Mac installs the driver automatically.

---

## 5. Configure Board Settings

**Tools** menu — set these exactly:

| Setting | Value |
|---|---|
| Board | `ESP32 Dev Module` |
| Upload Speed | `921600` |
| CPU Frequency | `240MHz` |
| Flash Size | `4MB (32Mb)` |
| Partition Scheme | `Default 4MB with spiffs` |
| Port | Mac: `/dev/cu.usbserial-XXXX` or `/dev/cu.SLAB_USBtoUART` / Windows: `COM3` (or similar) |

---

## 6. Open the Sketch

**File > Open** → navigate to `irrigation_main/irrigation_main.ino`

Make sure `config.h` exists in the same folder (copied from `config.h.example` with real values filled in).

**Required values before compiling:**

| Define | Where to get it |
|---|---|
| `FIREBASE_API_KEY` | Firebase console → Project settings → Web API key |
| `FIREBASE_EMAIL` | `esp32-irrigation@device.local` — device account (see firebase-setup.md §1) |
| `FIREBASE_PASSWORD` | Password you set when creating the device account |
| `FIREBASE_DB_URL` | Firebase console → Realtime Database → URL |
| `SITE_ID` | Open the PWA → hamburger menu → Settings → note the active site key, or check Firebase under `irrigation/sites/` |
| `ZONE_1_ID` / `ZONE_2_ID` | Must match zone IDs the PWA will create (default: `"balcony"` / `"garden"`) |

---

## 7. Verify (Compile)

Click the **checkmark (✓) Verify** button — do not upload yet.

**Expected output on success:**
```
Sketch uses 1278301 bytes (97%) of program storage space. Maximum is 1310720 bytes.
Global variables use 51608 bytes (15%) of dynamic memory, leaving 276072 bytes for local variables.
```

> Flash usage at 97% is expected — FirebaseESP32 + SSL libraries are large. The sketch runs fine.

**Safe to ignore:**
- `Multiple libraries were found for SD.h` — Arduino picks the correct one automatically

---

## 8. Upload

Click the **→ Upload** button.

### If upload hangs at `Connecting......`

The ESP32 needs to be manually put into download mode:

1. Watch the output for `Connecting......`
2. Hold the **BOOT** button on the ESP32
3. Keep holding until upload progress starts (`Writing at 0x00001000...`)
4. Release

Alternative sequence if BOOT alone doesn't work:
1. Hold **BOOT**
2. Press and release **EN** (reset) while still holding BOOT
3. Release **BOOT**
4. Click Upload immediately

If still failing, reduce upload speed: **Tools > Upload Speed > 115200**

---

## 9. Verify It's Running

**Tools > Serial Monitor** → set baud rate to **115200**

Press **EN** (reset) on the board. Expected output on first boot (no WiFi credentials stored):
```
[Boot] Irrigation controller starting...
[WiFi] Starting AP mode for provisioning...
[WiFi] AP IP: 192.168.4.1
[WiFi] Provisioning server started — connect to ESP32_Config
```

---

## 10. First Boot — WiFi Provisioning

On first boot the flash is empty, so the device starts in AP (access point) mode:

1. On your phone, connect to WiFi network: **`ESP32_Config`** (password: `123456789`)
2. Open browser → go to `192.168.4.1`
3. Enter your home WiFi SSID and password → tap Save
4. Device reboots and connects to your WiFi

On successful WiFi + Firebase connection you should see:
```
[WiFi] Connected, IP: 192.168.x.x
[Firebase] Initializing...
[Zone balcony] Moisture: 62% (raw 1840)
[Zone garden] Moisture: 58% (raw 1910)
[Boot] Setup complete
```

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `WiFi.h: No such file or directory` | ESP32 board package not installed | Complete step 2 |
| `'Zone' does not name a type` | Arduino auto-prototype bug with struct | Remove the unused `readMoisturePercent` function |
| `Failed to connect to ESP32` | Board not in download mode | Hold BOOT button during upload |
| `Compilation error: exit status 1` | Missing `config.h` | Copy `config.h.example` to `config.h` and fill in credentials |
| COM port not visible (Windows) | Missing USB driver | Complete step 4 |
