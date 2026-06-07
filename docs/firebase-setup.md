# Firebase Setup — Irrigation Control System

Documents every Firebase resource created for this project and how to recreate them from scratch.

---

## Project

| Field | Value |
|---|---|
| Project name | SmartHomeApp |
| Project ID | `smarthomeapp-982da` |
| Project number | `95863619710` |
| RTDB URL | `https://smarthomeapp-982da-default-rtdb.asia-southeast1.firebasedatabase.app` |
| RTDB region | `asia-southeast1` |

---

## Prerequisites

Install the Firebase CLI and log in:

```bash
npm install -g firebase-tools
firebase login
firebase projects:list   # confirm smarthomeapp-982da is listed
```

---

## 1. Firebase Accounts (Authentication)

The project uses two separate Firebase Auth accounts — one for the owner (human), one for the ESP32 device.

### Owner account
| Field | Value |
|---|---|
| Email | `nguyenvanthanh2210@gmail.com` |
| UID | `sKRHXxHf9cgzna8ce9UMdFvHZVZ2` |
| Purpose | Admin — issues commands, manages schedules, reads all data |

This account was created manually in the Firebase console.

### ESP32 device account
| Field | Value |
|---|---|
| Email | `esp32-irrigation@device.local` |
| UID | `2GVAabgRrafbeBkfpeagzYnnU9w2` |
| Purpose | Device-only — writes sensor data, reads and clears commands |

**Why a separate account?**
Using the owner's personal password in firmware is a security risk — if the device or codebase is compromised, the attacker gains full account access. The device account is isolated: if leaked, it can only write sensor data. It cannot issue valve commands or access any other data.

**How it was created (REST API — Firebase CLI has no `create user` command):**

```bash
# 1. Generate a strong random password
openssl rand -base64 16

# 2. Create the user via Identity Toolkit REST API
curl -s -X POST \
  "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=AIzaSyDEAP1XKmK8t1qt4fuXYN2ndZ3pbNNlLTU" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "esp32-irrigation@device.local",
    "password": "<generated-password>",
    "returnSecureToken": true
  }' | python3 -m json.tool
```

The response `localId` field is the UID — save it for use in security rules.

**To verify credentials work:**

```bash
curl -s -X POST \
  "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyDEAP1XKmK8t1qt4fuXYN2ndZ3pbNNlLTU" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "esp32-irrigation@device.local",
    "password": "<password>",
    "returnSecureToken": true
  }' | python3 -m json.tool
```

A response containing `idToken` confirms the credentials are valid.

---

## 2. API Key

Retrieved from the existing Web app registered in the project:

```bash
firebase apps:list --project smarthomeapp-982da
firebase apps:sdkconfig web <app-id> --project smarthomeapp-982da
```

| Field | Value |
|---|---|
| API Key | `AIzaSyDEAP1XKmK8t1qt4fuXYN2ndZ3pbNNlLTU` |
| App ID | `1:95863619710:web:50f331ff02dc5d92bfd82f` |

This key is safe to use in `config.h` — it is restricted by Firebase security rules to only allow authenticated access to the RTDB paths defined below.

---

## 3. Realtime Database (RTDB)

### Existing data
`/iot2025/` — pre-existing smart home data. Do not modify.

### Irrigation data
`/irrigation/` — created automatically by the ESP32 firmware on first boot. No manual setup needed.

**Schema:**
```
/irrigation/
  zones/
    {zone_id}/           # "balcony" | "garden"
      meta/
        name: string
        enabled: boolean
      sensor/
        moisturePercent: number
        rawValue: number
        timestamp: number
      valve/
        state: "OPEN" | "CLOSED"
        lastChangedAt: number
        openedBy: "auto" | "manual" | "schedule"
      command/
        action: "OPEN" | "CLOSE" | null
        issuedAt: number
        issuedBy: string
      schedule/
        {schedule_id}/
          hour: number
          minute: number
          durationMinutes: number
          enabled: boolean
          days: [0,1,2,3,4,5,6]
  devices/
    {device_id}/
      firmware: string
      lastSeen: number
      ipAddress: string
      wifiRssi: number
```

**To inspect RTDB data via CLI:**

```bash
# Check if irrigation path exists
firebase database:get /irrigation \
  --project smarthomeapp-982da \
  --instance smarthomeapp-982da-default-rtdb

# Watch a path in real time
firebase database:get /irrigation/zones/balcony/sensor \
  --project smarthomeapp-982da \
  --instance smarthomeapp-982da-default-rtdb \
  --watch
```

---

## 4. Security Rules

Rules are stored in `database.rules.json` at the repo root and deployed via `firebase.json`.

### Access matrix

| Path | Owner | ESP32 device | Anyone else |
|---|---|---|---|
| `/iot2025/` | read + write | none | denied |
| `sensor/` | read | write | denied |
| `valve/` | read | write | denied |
| `command/` | write | read + write (clear only) | denied |
| `schedule/` | read + write | read | denied |
| `devices/` | read | write | denied |
| everything else | denied | denied | denied |

### Deploy rules

```bash
# From the repo root (firebase.json must exist)
firebase deploy --only database --project smarthomeapp-982da
```

### Redeploy from scratch

If rules are ever lost or corrupted:

```bash
# Verify syntax before deploying
firebase database:rules --project smarthomeapp-982da \
  --instance smarthomeapp-982da-default-rtdb

# Deploy
firebase deploy --only database --project smarthomeapp-982da
```

---

## 5. Recreating Everything from Scratch

If you need to set up a fresh Firebase project:

1. Create project at console.firebase.google.com
2. Enable **Authentication > Email/Password** sign-in method
3. Create RTDB in the region closest to your device
4. Run `firebase login` and `firebase projects:list` to confirm access
5. Create the owner account in Firebase Console > Authentication > Users
6. Create the device account using the `curl` command in section 1
7. Note both UIDs and update `database.rules.json`
8. Update all values in `config.h` (API key, DB URL, device email/password)
9. Deploy rules: `firebase deploy --only database --project <project-id>`
10. Flash the firmware — the `/irrigation/` path will be created on first boot
