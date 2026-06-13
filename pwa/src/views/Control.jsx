import { useState } from 'react'
import { ref, set, serverTimestamp } from 'firebase/database'
import { db } from '../firebase'
import { useZoneData } from '../hooks/useZoneData'
import ConfirmDialog from '../components/ConfirmDialog'
import { logAudit } from '../utils/audit'
import { useSite } from '../context/SiteContext'

const MIN_DURATION = 1
const MAX_DURATION = 9
const DEFAULT_DURATION = 2

function ZoneControl({ zoneId, label }) {
  const { valve, command } = useZoneData(zoneId)
  const { sitePath } = useSite()
  const [pending,  setPending]  = useState(null)
  const [duration, setDuration] = useState(DEFAULT_DURATION)

  const isOpen     = valve?.state === 'OPEN'
  const hasPending = command?.action && command.action !== 'null'

  async function sendCommand(action) {
    await set(ref(db, sitePath(`zones/${zoneId}/command`)), {
      action,
      durationMinutes: action === 'OPEN' ? duration : null,
      issuedAt: serverTimestamp(),
      issuedBy: 'app'
    })
    logAudit(sitePath, 'VALVE_COMMAND', zoneId, { action, durationMinutes: duration })
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

      <div style={styles.durationRow}>
        <span style={styles.durationLabel}>Duration</span>
        <div style={styles.durationControls}>
          <button
            style={styles.durationBtn}
            disabled={duration <= MIN_DURATION}
            onClick={() => setDuration(d => Math.max(MIN_DURATION, d - 1))}
          >−</button>
          <span style={styles.durationValue}>{duration} min</span>
          <button
            style={styles.durationBtn}
            disabled={duration >= MAX_DURATION}
            onClick={() => setDuration(d => Math.min(MAX_DURATION, d + 1))}
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

      {pending && (
        <ConfirmDialog
          message={`Open the ${label} valve for ${duration} minute${duration > 1 ? 's' : ''}?`}
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
        OPEN commands require confirmation. Set duration (1–9 min) before opening.
      </p>
      {zones.length === 0 && (
        <p style={styles.empty}>No zones configured for this site.</p>
      )}
      {zones.map(z => (
        <ZoneControl key={z.id} zoneId={z.id} label={z.label} />
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
  empty:         { color: '#3a5a45', fontSize: '0.9rem', textAlign: 'center', marginTop: '2rem' }
}
