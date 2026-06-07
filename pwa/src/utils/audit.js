import { ref, push } from 'firebase/database'
import { db, auth } from '../firebase'

// Fire-and-forget — never throws, never blocks the calling action
export async function logAudit(action, zone, details = {}) {
  try {
    await push(ref(db, 'irrigation/auditLog'), {
      action,
      zone:      zone ?? null,
      user:      auth.currentUser?.email ?? 'unknown',
      timestamp: Date.now(),
      details
    })
  } catch { /* audit failure must never break the main operation */ }
}
