# Firebase RTDB Permission Design

Reference for all security rules in `database.rules.json`.
Deploy: `firebase deploy --only database --project smarthomeapp-982da`

---

## Identities

| Identity | Auth mechanism | UID / selector |
|---|---|---|
| **Owner** (personal) | Email/password | `sKRHXxHf9cgzna8ce9UMdFvHZVZ2` |
| **Owner** (test account) | Email/password | `BUqnab10ASdHkwAM3HOezLIq6qe2` |
| **ESP32 device** | Email/password (firmware) | `2GVAabgRrafbeBkfpeagzYnnU9w2` |
| **Guest** | Anonymous sign-in | `auth.token.firebase.sign_in_provider === 'anonymous'` |
| **Cloud Function** | Admin SDK (server-side) | Bypasses all rules |

---

## Permission Matrix

`R` = read  `W` = write  `—` = denied

| Path | Owner | Device | Guest |
|---|---|---|---|
| `iot2025/` | R W | — | — |
| `sites/{id}/meta/` | R W | — | R |
| `sites/{id}/devices/{id}/meta/` | R W | R W | R |
| `sites/{id}/devices/{id}/config/` | R W | R | — |
| `sites/{id}/devices/{id}/zones/{id}/meta/` | R W | R W | R |
| `sites/{id}/devices/{id}/zones/{id}/sensor/` | R W | R W | R |
| `sites/{id}/devices/{id}/zones/{id}/valve/` | R W | R W | R |
| `sites/{id}/devices/{id}/zones/{id}/command/` | R W | R W | — |
| `sites/{id}/devices/{id}/zones/{id}/schedule/` | R W | R | R |
| `sites/{id}/devices/{id}/zones/{id}/history/` | R W | R W | R |
| `sites/{id}/auditLog/` | R W | — | R |
| `sites/{id}/settings/` | R W | — | — |
| `sites/{id}/alertCooldowns/` | R W | — | — |
| everything else | — | — | — |

---

## Design decisions

### No broad parent grant at `$site_id` level
The `$site_id` node has **no `.read` or `.write` rule**. Every child path declares its own access explicitly.

**Why:** Firebase RTDB rules cascade downward — a parent `.read: true` grants access to all children with no way to restrict a specific child. An earlier version granted anonymous read at `$site_id` level, which silently exposed `settings/` (Telegram token) and `alertCooldowns/` to guests.

### `settings/` — owners only, no guests
Contains the Telegram bot token and chat ID. If readable by guests, any visitor could extract the token and use the bot to send messages or read chat history. The `useAlertMonitor` hook gracefully handles a null settings response (no token → no alerts fired for guest sessions).

### `alertCooldowns/` — owners only
Stores timestamps of last-sent alert per device/zone to prevent alert spam across tabs. Added when cooldown tracking moved from `localStorage` (per-tab) to Firebase (shared). Cloud Function writes here too via Admin SDK, which bypasses rules.

### `command/` — device included in both read and write
The device needs **read** to poll the command channel and **write** to clear `action` to `"null"` after acting. Guests are excluded from both — they cannot see pending commands or issue new ones.

### `config/` — no guest access
Runtime config (sensor interval, enabled flags) has no display value for guests. Excluding guests reduces the set of paths that produce permission errors in guest sessions.

### `zones/{id}/meta/` — device included in read
The device reads zone meta on boot to check if a name already exists before writing the default. The rule explicitly includes the device UID (even though the parent `meta` already grants it) so the intent is clear when reading the rules in isolation.

---

## How cascade works (Firebase RTDB)

> If a parent node grants `.read` to a user, **all child nodes are also readable** by that user — child rules cannot revoke a parent grant.
> Child rules can only **add** access, never restrict it.

This is why the `$site_id` parent has no broad grant — all access is declared at leaf level.

Example: `sensor/` grants anonymous read. `config/` does not. Both are children of `$device_id/`, which has no `.read` rule of its own. This works correctly because each path is self-contained.

---

## `database.rules.json` path map

```
irrigation/
  sites/
    $site_id/
      meta/           → owners R/W | guests R
      devices/
        $device_id/
          meta/       → owners R/W | device R/W | guests R    (heartbeat, lastDiagnostic, freeHeap)
          config/     → owners R/W | device R                  (sensorIntervalMs, sensorEnabled)
          zones/
            $zone_id/
              meta/   → owners R/W | device R/W | guests R    (name, enabled, map position)
              sensor/ → owners R/W | device R/W | guests R    (moisturePercent, rawValue, timestamp)
              valve/  → owners R/W | device R/W | guests R    (state, lastChangedAt, openedBy)
              command/→ owners R/W | device R/W               (action, durationSeconds, issuedAt)
              schedule/→ owners R/W | device R | guests R     (hour, minute, days, enabled)
              history/→ owners R/W | device R/W | guests R    (indexed on timestamp)
      auditLog/       → owners R/W | guests R                 (indexed on timestamp)
      settings/       → owners R/W only                       (telegram token — sensitive)
      alertCooldowns/ → owners R/W only                       (also written by Cloud Function/Admin SDK)
```

---

## Checklist when adding a new path

1. Decide: which identities need read? write?
2. Add an explicit rule for the new path in `database.rules.json`
3. Do **not** rely on parent cascade for new paths — declare intent explicitly
4. If the path is sensitive (credentials, tokens, PII): exclude guests and device
5. If the Cloud Function (Admin SDK) writes to it: no rule needed for that write, but add rules for PWA reads/writes
6. Run `firebase deploy --only database`
7. Check serial monitor — `Permission denied` in `fbdo.errorReason()` means the rule is missing

---

## Deploy

```bash
# From repo root
firebase deploy --only database --project smarthomeapp-982da
```

Verify deployed rules:
```bash
firebase database:rules \
  --project smarthomeapp-982da \
  --instance smarthomeapp-982da-default-rtdb
```
