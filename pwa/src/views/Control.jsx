import { useState } from 'react'
import { ref, set, serverTimestamp } from 'firebase/database'
import { db } from '../firebase'
import { useZoneData } from '../hooks/useZoneData'
import ConfirmDialog from '../components/ConfirmDialog'
import { logAudit } from '../utils/audit'
import { useSite } from '../context/SiteContext'
import { useAuth } from '../App'

const MIN_SECONDS     = 30       // 30 seconds minimum
const MAX_SECONDS     = 3 * 60  // 3 minutes maximum (matches firmware MAX_VALVE_MS)
const DEFAULT_SECONDS = 30      // default: 0 min 30 sec
const STEP_SECONDS    = 30      // increment/decrement in 30s steps

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  if (m === 0) return `${s}s`
  if (s === 0) return `${m}m`
  return `${m}m ${s}s`
}

function ZoneControl({ zoneId, deviceId, label }) {
  const { valve, command } = useZoneData({ zoneId, deviceId })
  const { sitePath } = useSite()
  const { isGuest } = useAuth()
  const [pending,        setPending]        = useState(null)
  const [durationSeconds, setDurationSeconds] = useState(DEFAULT_SECONDS)

  const isOpen     = valve?.state === 'OPEN'
  const hasPending = command?.action && command.action !== 'null'

  async function sendCommand(action) {
    await set(ref(db, sitePath(`devices/${deviceId}/zones/${zoneId}/command`)), {
      action,
      durationSeconds: action === 'OPEN' ? durationSeconds : null,
      issuedAt: serverTimestamp(),
      issuedBy: 'app'
    })
    logAudit(sitePath, 'VALVE_COMMAND', `${deviceId}/${zoneId}`, { action, durationSeconds })
  }

  function handlePress(action) {
    if (action === 'OPEN') {
      setPending({ action })
    } else {
      sendCommand(action)
    }
  }

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <span style={styles.label}>{label}</span>
        <span style={{ ...styles.badge, background: isOpen ? '#e05c3a' : '#1a7f4b' }}>
          {isOpen ? 'OPEN' : 'CLOSED'}
        </span>
      </div>

      {hasPending && (
        <div style={styles.pendingBanner}>
          Command pending: {command.action} — waiting for device...
        </div>
      )}

      {isGuest ? (
        <p style={styles.guestNotice}>Sign in to control valves</p>
      ) : (
        <>
          <div style={styles.durationRow}>
            <span style={styles.durationLabel}>Duration</span>
            <div style={styles.durationControls}>
              <button
                style={styles.durationBtn}
                disabled={durationSeconds <= MIN_SECONDS}
                onClick={() => setDurationSeconds(d => Math.max(MIN_SECONDS, d - STEP_SECONDS))}
              >−</button>
              <span style={styles.durationValue}>{formatDuration(durationSeconds)}</span>
              <button
                style={styles.durationBtn}
                disabled={durationSeconds >= MAX_SECONDS}
                onClick={() => setDurationSeconds(d => Math.min(MAX_SECONDS, d + STEP_SECONDS))}
              >+</button>
            </div>
          </div>

          <div style={styles.btnRow}>
            <button
              style={{ ...styles.btn, ...styles.btnOpen }}
              disabled={isOpen || hasPending}
              onClick={() => handlePress('OPEN')}
            >
              Open Valve
            </button>
            <button
              style={{ ...styles.btn, ...styles.btnClose }}
              disabled={!isOpen || hasPending}
              onClick={() => handlePress('CLOSE')}
            >
              Close Valve
            </button>
          </div>
        </>
      )}

      {pending && (
        <ConfirmDialog
          message={`Open the ${label} valve for ${formatDuration(durationSeconds)}?`}
          onConfirm={() => { sendCommand(pending.action); setPending(null) }}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  )
}

export default function Control() {
  const { zones } = useSite()
  return (
    <div style={styles.page}>
      <p style={styles.note}>
        OPEN commands require confirmation. Set duration (30s–9m, in 30s steps) before opening.
      </p>
      {zones.length === 0 && (
        <p style={styles.empty}>No zones configured for this site.</p>
      )}
      {zones.map(z => (
        <ZoneControl key={z.id} zoneId={z.id} deviceId={z.deviceId} label={z.label} />
      ))}
    </div>
  )
}

const styles = {
  page:          { display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' },
  note:          { color: '#7aab90', fontSize: '0.85rem', margin: 0 },
  card:          { background: '#1e2d24', borderRadius: '12px', padding: '1.25rem' },
  header:        { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
  label:         { color: '#e0f0e8', fontSize: '1.1rem', fontWeight: 600 },
  badge:         { color: '#fff', fontSize: '0.78rem', fontWeight: 700, padding: '0.3rem 0.7rem', borderRadius: '6px' },
  pendingBanner: { background: '#2a3d2e', color: '#e0b03a', fontSize: '0.85rem', padding: '0.6rem 0.85rem', borderRadius: '8px', marginBottom: '0.75rem' },
  durationRow:     { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
  durationLabel:   { color: '#7aab90', fontSize: '0.9rem' },
  durationControls:{ display: 'flex', alignItems: 'center', gap: '0.75rem' },
  durationBtn:     { background: '#2e4a38', border: 'none', borderRadius: '8px', color: '#e0f0e8', fontSize: '1.1rem', fontWeight: 700, width: '36px', height: '36px', cursor: 'pointer', lineHeight: 1 },
  durationValue:   { color: '#e0f0e8', fontSize: '0.95rem', fontWeight: 600, minWidth: '52px', textAlign: 'center' },
  btnRow:        { display: 'flex', gap: '0.75rem' },
  btn:           { flex: 1, padding: '1rem', borderRadius: '12px', border: 'none', fontSize: '1rem', fontWeight: 600, cursor: 'pointer', transition: 'opacity 0.2s' },
  btnOpen:       { background: '#e05c3a', color: '#fff' },
  btnClose:      { background: '#2e4a38', color: '#a0c8b0' },
  empty:         { color: '#3a5a45', fontSize: '0.9rem', textAlign: 'center', marginTop: '2rem' },
  guestNotice:   { color: '#4a7a5a', fontSize: '0.85rem', fontStyle: 'italic', margin: '0.5rem 0 0' }
}
