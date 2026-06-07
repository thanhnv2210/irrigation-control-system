# Flashing the ESP32 on Windows

## 1. Install Arduino IDE
Download and install **Arduino IDE 2.x** from arduino.cc.

## 2. Add ESP32 board support
1. Open Arduino IDE → **File > Preferences**
2. In "Additional boards manager URLs" paste:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. Go to **Tools > Board > Boards Manager**, search `esp32`, install **esp32 by Espressif Systems**

## 3. Install the FirebaseESP32 library
**Tools > Manage Libraries** → search `FirebaseESP32` → install **Firebase ESP32 Client by Mobizt**

## 4. Get the code onto the Windows machine
Options (pick one):
- **Git clone** the repo if Git is installed: `git clone <your-repo-url>`
- **Copy the files** via USB drive or cloud sync (just need the `irrigation_main/` folder)

## 5. Create `config.h`
In the `irrigation_main/` folder, copy `config.h.example` to `config.h` and fill in:
- Firebase API key, email, password, DB URL
- Leave calibration values (`DRY_RAW`, `WET_RAW`) at defaults for now — update after measuring from real hardware

## 6. Install the USB driver
ESP32 DevKits typically use a **CH340** or **CP2102** USB-to-serial chip. Windows often needs a driver:
- CH340: search "CH340 driver Windows" → install from wch.cn
- CP2102: search "CP2102 driver" → install from Silicon Labs site

Plug in the board — Device Manager should show a **COM port** (e.g. `COM3`).

## 7. Open and flash
1. **File > Open** → select `irrigation_main/irrigation_main.ino`
2. **Tools > Board** → select `ESP32 Dev Module`
3. **Tools > Port** → select the COM port that appeared
4. Click **Upload** (→ arrow button)

If upload fails, hold the **BOOT button** on the ESP32 while the IDE shows "Connecting..." then release.

## 8. Verify it's running
- **Tools > Serial Monitor**, baud rate **115200**
- You should see boot messages — either connecting to saved WiFi or starting AP mode

## First boot — WiFi provisioning
Since flash is empty on first boot, the device starts in AP mode:
1. Connect your phone to `ESP32_Config` (password `123456789`)
2. Open `192.168.4.1` in the phone browser
3. Enter your home WiFi credentials and submit
4. Device reboots and connects to WiFi automatically
