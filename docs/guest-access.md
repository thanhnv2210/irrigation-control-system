# Guest Access — View-Only Mode

The PWA supports a guest login that lets anyone view the live dashboard without being able to change anything. Guests see moisture readings, valve states, device status, schedules, statistics, and the audit log — but all write controls are hidden.

---

## What guests can and cannot do

| Feature | Guest | Owner |
|---|---|---|
| Dashboard — live moisture, valve state, device status | ✅ | ✅ |
| Statistics — moisture history charts | ✅ | ✅ |
| Schedule — view schedules | ✅ | ✅ |
| Audit Log — valve event history | ✅ | ✅ |
| Alerts — view current config | ✅ | ✅ |
| Garden Map — zone pin positions | ✅ | ✅ |
| Control — open/close valves | ❌ | ✅ |
| Schedule — add / edit / delete | ❌ | ✅ |
| Dashboard — rename zones or devices | ❌ | ✅ |
| Alerts — save Telegram config or thresholds | ❌ | ✅ |
| Settings — create / rename / delete sites | ❌ | ✅ |
| Simulator | ❌ | ✅ |

Guest access uses Firebase Anonymous Authentication. Each guest session gets a temporary UID that expires when the browser tab closes. No account or password is needed.

---

## How to enable (one-time Firebase setup)

Anonymous Authentication must be enabled in Firebase before guests can sign in. It is off by default.

### Steps

1. Open the Firebase console and navigate to your project:
   `https://console.firebase.google.com/project/smarthomeapp-982da/authentication/providers`

2. Find **Anonymous** in the provider list and click it.

3. Toggle **Enable** to on.

4. Click **Save**.

That's it — no code change or redeployment needed. Guest sign-in will work immediately.

---

## How it works

### Login screen

The login screen shows a "Continue as Guest" button below the sign-in form. Tapping it calls `signInAnonymously()` from the Firebase JS SDK, which creates a temporary anonymous Firebase user. No email or password is required.

### Role detection

`user.isAnonymous` from `onAuthStateChanged` is `true` for guest sessions. The app wraps everything in an `AuthContext` that exposes `isGuest`. Each view imports `useAuth()` and conditionally hides write controls when `isGuest` is true.

### Firebase security rules

The database rules use `auth.token.firebase.sign_in_provider === 'anonymous'` to grant read-only access to all irrigation paths. Write rules are unchanged — only the two owner UIDs can write.

```json
".read": "auth != null && (
  auth.uid === 'sKRHXxHf9cgzna8ce9UMdFvHZVZ2' ||
  auth.uid === 'BUqnab10ASdHkwAM3HOezLIq6qe2' ||
  auth.token.firebase.sign_in_provider === 'anonymous'
)"
```

The `command` path (which sends valve commands to the ESP32) does **not** grant anonymous read access — guests cannot see pending commands and cannot write them.

### Drawer display

When signed in as guest, the drawer shows "Guest" as the display name and "View-only access" in place of the email address.

---

## Security notes

- Anonymous sessions are Firebase-authenticated — unauthenticated requests are still blocked by Firebase rules.
- The data exposed to guests (moisture %, valve state, device RSSI) is non-sensitive for a personal garden system.
- Telegram bot tokens and chat IDs are visible in the Alerts view but the save buttons are hidden, so guests cannot change them. If this is a concern, the Alerts card can be hidden for guests by adding `{!isGuest && <Alerts />}` in the relevant render.
- Firebase automatically cleans up anonymous accounts that have not been used for 30 days.
