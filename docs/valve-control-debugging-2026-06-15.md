# Valve Control Debugging — 2026-06-15

## Problem

After restructuring the Firebase schema (Option B — zones moved under devices),
clicking Open/Close Valve in the PWA resulted in a stuck "Command pending — waiting
for device..." banner. The valve never responded.

---

## Root Causes Found (in order of discovery)

### 1. PWA was writing to new paths, firmware was reading old paths

After the schema restructure, the PWA was updated to write commands to:
```
irrigation/sites/default/devices/esp32-01/zones/balcony/command
```

But the firmware had not been reflashed yet and was still listening on:
```
irrigation/sites/default/zones/balcony/command
```

The command sat at the new path unread. The firmware stream never fired.

**Fix:** Flash the firmware before using the updated PWA. Always reflash both
boards immediately after any Firebase path change.

**How to clear a stuck command without the board:**
```bash
echo "Y" | firebase database:remove --project smarthomeapp-982da \
  "/irrigation/sites/default/devices/esp32-01/zones/balcony/command"
```

---

### 2. Firebase security rules not deployed after restructure

After reflashing the firmware (now reading the correct new paths), the poll still
failed with **Permission denied** on every cycle:

```
[Cmd] Poll FAILED for balcony: Permission denied
[Cmd] Poll FAILED for garden: Permission denied
```

The local `database.rules.json` had been rewritten for the new schema (zones under
devices), but `firebase deploy --only database` was never run. The live rules in
Firebase still had the old flat `zones/` structure — which did not grant the device
UID read access to `devices/$device_id/zones/$zone_id/command`.

**Fix:**
```bash
firebase deploy --only database --project smarthomeapp-982da
```

**Lesson:** Any time `database.rules.json` is changed, deploy immediately. Verify
with:
```bash
firebase database:get --project smarthomeapp-982da "/.settings/rules" | head -20
```
The output should match what is in `database.rules.json`.

---

### 3. SSL stream drops cause missed commands

The FirebaseESP32 stream (`Firebase.beginStream`) disconnects with SSL errors
roughly every 1–2 minutes:

```
ERROR.mRunUntil: SSL internals timed out!
ERROR.mConnectSSL: Failed to initialize the SSL layer.
[Firebase] Stream Z1 dropped — restarting
```

When a command arrives during this window, the stream callback never fires.
`checkStreams()` restarts the stream, but FirebaseESP32 does not re-deliver
the current value after reconnect — so the command is silently missed.

**Fix:** Added `pollCommand()` — a direct `Firebase.getString()` read on
`command/action` that runs every 3 seconds regardless of stream health:

```cpp
void pollCommand(int zoneIdx) {
  String cmdPath = zonePath(zones[zoneIdx].id) + "/command/action";
  if (Firebase.getString(fbdo, cmdPath)) {
    String action = fbdo.stringData();
    action.trim();
    if (action.length() > 0 && action != "null") {
      handleCommand(zoneIdx, action);
    }
  }
}
```

This poll runs unconditionally (not gated on `Firebase.ready()`) so it keeps
trying even during SSL recovery. The stream callbacks remain in place as a
faster path when streams are healthy.

---

## Stale Data Cleanup

During debugging, the Firebase `default` site had mixed old and new structures:
- Old flat fields (`lastSeen`, `name`, `firmware`) directly on `devices/esp32-01`
- New `meta/` node also on `devices/esp32-01`
- Old flat `zones/` node still present at site level

The entire site was wiped and the board re-registered cleanly on next boot:

```bash
echo "Y" | firebase database:remove --project smarthomeapp-982da \
  "/irrigation/sites/default"
```

After restart, the firmware automatically re-creates:
- `devices/esp32-01/meta/` — heartbeat fields
- `devices/esp32-01/zones/balcony/meta/` — zone metadata
- `devices/esp32-01/zones/garden/meta/` — zone metadata

---

## Debugging Approach That Worked

The key was adding verbose logging to `pollCommand()` so the Serial Monitor
showed exactly what was happening on every cycle:

```
[Cmd] --- Poll #1 | uptime 8s | Firebase.ready=YES ---
[Cmd] Polling balcony → irrigation/sites/.../command/action
[Cmd] Poll FAILED for balcony: Permission denied   ← told us it was a rules problem
```

Without this log, the failure looked identical to a network timeout or wrong path.

Logs added to firmware:
- Poll counter + `Firebase.ready()` status every 3s
- Full path being polled (confirms path is correct after restructure)
- Error reason on poll failure (distinguishes rules vs network vs wrong path)
- Stream Z1/Z2 health status every 10s
- `openValve()` relay pin state + Firebase write results
- `handleCommand()` entry log with action and duration read result

---

## Deployment Checklist After Any Schema Change

1. Update `database.rules.json`
2. **Deploy rules immediately:** `firebase deploy --only database --project smarthomeapp-982da`
3. Update firmware path helpers (`zonePath`, `devicePath`)
4. Update all PWA files that reference Firebase paths
5. **Flash all boards** before using the updated PWA
6. Clear any stuck commands in Firebase before testing
7. Watch Serial Monitor on first boot to confirm paths match

---

## Final State After Fix

- Firmware polls `command/action` every 3s as primary mechanism
- Streams remain as a faster supplementary path
- Valve opens and closes reliably within 3 seconds of PWA tap
- Security rules correctly grant device UID read on `command` path
