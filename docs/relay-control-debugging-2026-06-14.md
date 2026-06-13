# Relay Control Debugging — 2026-06-14

Session log for diagnosing and fixing the relay control issues found during first hardware integration testing.

---

## Hardware Used (Practice Setup)

- ESP32-D0WD-V3 (revision 3.1), MAC: `1c:c3:ab:f9:ac:50`
- Relay module: 250VAC 10A (used for practice with 5V DC load via USB power)
- 5V DC load powered from USB cable — no solenoid valve connected yet
- Both zones tested: balcony (GPIO 26) and garden (GPIO 27)

---

## Issues Found and Fixed

### Issue 1 — Garden relay not responding to commands

**Symptom:** Balcony relay opened and closed correctly. Garden relay did not respond to any OPEN or CLOSE command from the PWA.

**Root cause:** Firebase stream for zone 2 (garden) failed silently on boot due to an SSL error during initialization:
```
> WARN.mRunUntil: Terminating because the ssl engine closed.
> ERROR.mConnectSSL: Failed to initialize the SSL layer.
```
The stream for garden never established, so commands written to Firebase were never received by the firmware.

**Fix:** Added `checkStreams()` function called every 10 seconds in `loop()`. It detects dropped streams and restarts them automatically:
```cpp
if (!Firebase.readStream(streamZ2) || streamZ2.streamTimeout()) {
  Firebase.beginStream(streamZ2, cmdPath2);
  Firebase.setStreamCallback(streamZ2, streamCallbackZ2, streamTimeoutCallback);
}
```

---

### Issue 2 — Garden valve stuck showing OPEN after restart

**Symptom:** After ESP32 restart, Firebase showed `garden/valve/state = "OPEN"` but relay was physically closed. Sending CLOSE command from PWA had no effect — firmware logs showed `valve: CLOSED` immediately (internal state disagreed with Firebase).

**Root cause:** On cold start, `z.valveOpen` is initialized to `false`. When a CLOSE command arrived, `closeValve()` hit `if (!z.valveOpen) return` and exited without touching the relay or writing to Firebase. The stale OPEN state in Firebase was never cleared.

**Fix 1 — Boot sync:** On every boot, all relays are forced CLOSED (hardware first), internal state set to `false`, and Firebase written as `CLOSED` unconditionally:
```cpp
for (int i = 0; i < 2; i++) {
  digitalWrite(zones[i].relayPin, HIGH);  // hardware close — always
  zones[i].valveOpen = false;
  scheduleCloseAt[i] = 0;
  Firebase.setString(fbdo, statePath, "CLOSED");
}
```

**Fix 2 — closeValve() safety net:** Even when `z.valveOpen = false`, `closeValve()` now forces relay HIGH and syncs Firebase instead of silently returning. This handles any future state divergence.

---

### Issue 3 — Simulator AdHocActions conflicting with firmware

**Symptom:** Garden valve showed OPEN in PWA dashboard even after firmware confirmed CLOSED. Traced to the Simulator tab's "Valve OPEN" button being accidentally clicked — it writes `valve/state` directly to Firebase, bypassing the command channel. Firmware never gets notified so it never corrects the state.

**Fix:** Added a real-time warning banner in the Simulator tab that appears whenever the real device is online (heartbeat within last 90 seconds):
```
"Real device is online. Simulator actions write directly to Firebase
and will conflict with firmware. Use the Control tab instead."
```

---

### Issue 4 — Diagnostic logging added

Added `DEBUG_PRINT_SECRETS` flag in `config.h` to control whether sensitive values appear in boot log:

```cpp
#define DEBUG_PRINT_SECRETS   0  // set to 1 to reveal credentials in Serial Monitor
```

Boot config dump now prints on every restart:
- Firmware version, device ID, site ID, zone IDs
- WiFi SSID, GPIO pin assignments
- Calibration values (DRY_RAW, WET_RAW)
- Timing constants
- Credentials hidden by default, revealed when flag = 1

---

### Issue 5 — WiFi diagnostic status codes

First WiFi connection attempt failed with no useful error. Added status code logging after timeout:
- Code `1` = SSID not found
- Code `4` = wrong password
- Code `6` = disconnected (band mismatch — ESP32 only supports 2.4GHz)

Root cause: Router had separate 2.4GHz (`SINGTEL-WNP6`) and 5GHz (`SINGTEL-H4VA`) networks. ESP32 was pointed at the 5GHz SSID.

---

## Final Working State

- Both relays (GPIO 26 balcony, GPIO 27 garden) respond correctly to OPEN/CLOSE from PWA
- Boot forces all relays CLOSED and syncs Firebase — no stale state after restart
- Dropped Firebase streams auto-recover within 10 seconds
- WiFi credentials saved to flash — no provisioning needed on re-flash
- 5V DC load (USB powered) confirmed switching correctly on both channels

---

## Next Steps

- Connect actual 12V solenoid valves (relay rated 250VAC 10A — suitable)
- Wire solenoid: COM → 12V PSU(+), NO → solenoid(+), solenoid(−) → 12V PSU(−)
- Verify flyback diode on relay module before connecting solenoid
- Do NOT test with water supply until wiring is physically verified
