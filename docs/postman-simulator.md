# Postman Device Simulator — Guide

Simulates ESP32 firmware behavior against Firebase RTDB while waiting for real hardware.
Use this to develop and test the PWA end-to-end without a physical device.

---

## Setup

### 1. Import the collection
1. Open Postman
2. Click **Import** → drag in `irrigation-device-simulator.postman_collection.json` from the repo root
3. The collection appears in your sidebar as **Irrigation — Device Simulator**

### 2. Check collection variables
Click the collection → **Variables** tab. These are pre-filled:

| Variable | Value | Notes |
|---|---|---|
| `api_key` | `AIzaSyD...` | Firebase Web API key |
| `db_url` | `https://smarthomeapp-982da-...` | RTDB base URL |
| `device_email` | `esp32-irrigation@device.local` | ESP32 device account |
| `device_pass` | `KqEodVoVeUx8JD6qchDrtw==` | ESP32 device password |
| `id_token` | _(empty)_ | Auto-filled after sign-in |
| `zone1` | `balcony` | Zone 1 ID |
| `zone2` | `garden` | Zone 2 ID |
| `device_id` | `esp32-01` | Device heartbeat path |

**Do not commit** the collection to a public repository — it contains device credentials.

---

## Always Do This First

Run **1. Auth → Sign in as ESP32 device** before anything else.

The test script automatically saves the `id_token` to the collection variable. All other requests use this token. Tokens expire after 1 hour — re-run sign-in if requests start returning `401`.

---

## Folders and Requests

### 1. Auth
**Sign in as ESP32 device**
Authenticates the device account and stores the token.

- Method: `POST`
- Endpoint: Firebase Identity Toolkit `signInWithPassword`
- Auto-saves `id_token` on success

---

### 2. Device Heartbeat
**Publish heartbeat (boot / 60s)**
Simulates the ESP32 writing its status to Firebase every 60 seconds.

Writes to: `/irrigation/devices/esp32-01`

```json
{
  "firmware": "1.0.0",
  "ipAddress": "192.168.1.99",
  "wifiRssi": -58,
  "lastSeen": { ".sv": "timestamp" }
}
```

> In the PWA Dashboard, the device status bar reads `lastSeen` to determine online/offline. Run this request to make the device appear **online**. If `lastSeen` is older than 90 seconds, the PWA shows **offline**.

---

### 3. Sensor Publish
Simulates the ESP32 reading soil sensors and writing to Firebase every 30 seconds.

| Request | `moisturePercent` | Use case |
|---|---|---|
| Zone 1 — healthy moisture | 62% | Normal operation |
| Zone 1 — dry (alert threshold) | 22% | Test red gauge in PWA |
| Zone 2 — healthy moisture | 45% | Normal operation |

Writes to: `/irrigation/zones/{zone}/sensor`

```json
{
  "moisturePercent": 62,
  "rawValue": 1840,
  "timestamp": { ".sv": "timestamp" }
}
```

> Run different moisture values to see the PWA gauge change color:
> - Green: ≥ 60%
> - Yellow: 30–59%
> - Red: < 30%

---

### 4. Valve State
Simulates the ESP32 writing valve state back to Firebase after acting on a command.

| Request | State | openedBy |
|---|---|---|
| Zone 1 — OPEN | `OPEN` | `manual` |
| Zone 1 — CLOSED | `CLOSED` | `manual` |
| Zone 2 — OPEN (schedule) | `OPEN` | `schedule` |
| Zone 2 — CLOSED | `CLOSED` | `schedule` |

Writes to: `/irrigation/zones/{zone}/valve`

> **Important:** In the real firmware, the valve state is written *after* the relay is physically toggled. Never write valve state before confirming the relay acted. In this simulator, sequence matters — open then close.

---

### 5. Command Channel
Simulates how the ESP32 reads and clears commands issued by the PWA.

**Read zone 1 command**
- Method: `GET`
- Path: `/irrigation/zones/balcony/command`
- Returns the pending command (or `null` if none)

The test script logs the `action` field to the Postman console — check **View > Show Postman Console** to see it.

**Clear zone 1 / zone 2 command**
- Method: `PATCH`
- Sets `action` to `null`
- Simulates the firmware clearing the command after acting on it

> **Test the full command flow:**
> 1. Open PWA → Control tab → press **Open Valve** on Balcony → confirm
> 2. Run **Read zone 1 command** → confirm `action: "OPEN"` appears
> 3. Run **Zone 1 OPEN** from folder 4 (valve state write)
> 4. Run **Clear zone 1 command** → simulates firmware clearing it
> 5. PWA should show valve as OPEN and command cleared

---

### 6. Full Boot Sequence
Runs all 5 steps in order to reproduce exactly what the ESP32 does on power-up.

| Step | Action |
|---|---|
| 1 | Sign in — get token |
| 2 | Publish heartbeat |
| 3 | Publish initial sensor readings (zone 1) |
| 4 | Check for pending command |
| 5 | Write valve CLOSED (cold start default) |

**Use this to:**
- Seed all Firebase data at once so the PWA dashboard populates
- Run as a Postman Collection Runner for repeated boot simulation

---

## Common Test Scenarios

### Scenario A — Fresh start, populate dashboard
1. Run **1. Auth → Sign in**
2. Run **6. Full Boot Sequence** (all 5 steps)
3. Run **3. Sensor Publish → Zone 2 healthy**
4. Open PWA — both zones should show data, device online

---

### Scenario B — Test manual valve control from PWA
1. Run sign-in if token expired
2. Open PWA → Control → **Open Valve** on Balcony → confirm
3. Run **5. Command Channel → Read zone 1 command** → verify `action: "OPEN"`
4. Run **4. Valve State → Zone 1 OPEN** → simulates relay triggered
5. Run **5. Command Channel → Clear zone 1 command** → simulates firmware clearing it
6. PWA Dashboard should now show Balcony valve as **OPEN**

---

### Scenario C — Test schedule trigger
1. Add a schedule in PWA → Schedule tab → Balcony → **+ Add**
2. Set time to 2 minutes from now, any day including today, duration 5 min
3. Wait for the minute → run **4. Valve State → Zone 1 OPEN (schedule)**
4. Run **4. Valve State → Zone 1 CLOSED** after 5 minutes
5. PWA Dashboard should reflect the state changes in real time

---

### Scenario D — Test dry soil alert (for future M5 alert)
1. Run **3. Sensor Publish → Zone 1 dry**
2. PWA gauge turns red (< 30%)
3. This is the trigger condition for the low moisture alert in M5

---

## Tips

- **Postman Console** (`View > Show Postman Console`) shows `console.log` output from test scripts — useful for seeing command action values
- **Collection Runner** (`Run collection`) lets you run all requests in a folder automatically — useful for the boot sequence
- Tokens expire after **1 hour** — re-run sign-in if you get `401 Unauthorized`
- The `.sv: timestamp` syntax tells Firebase to use server time — do not replace with a hardcoded number
- Running **Zone 1 OPEN** and then immediately **Zone 1 CLOSED** is fine — the PWA updates in real time via `onValue()` stream
