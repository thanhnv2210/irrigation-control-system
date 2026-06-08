import { useState } from 'react'
import { ref, set, serverTimestamp } from 'firebase/database'
import { db } from '../firebase'
import { useZoneData } from '../hooks/useZoneData'
import ConfirmDialog from '../components/ConfirmDialog'
import { logAudit } from '../utils/audit'
import { useSite } from '../context/SiteContext'

const ZONES = [
  { id: 'balcony', label: 'Balcony' },
  { id: 'garden',  label: 'Garden' }
]

function ZoneControl({ zoneId, label }) {
  const { valve, command } = useZoneData(zoneId)
  const { sitePath } = useSite()
  const [pending, setPending] = useState(null)

  const isOpen     = valve?.state === 'OPEN'
  const hasPending = command?.action && command.action !== 'null'

  async function sendCommand(action) {
    await set(ref(db, sitePath(`zones/${zoneId}/command`)), {
      action,
      issuedAt: serverTimestamp(),
      issuedBy: 'app'
    })
    logAudit(sitePath, 'VALVE_COMMAND', zoneId, { action })
  }

  function handlePress(action) {
    if (action === 'OPEN') {
      setPending({ action })  // requires confirmation
    } else {
      sendCommand(action)     // CLOSE is immediate — no confirmation needed
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
          message={`Open the ${label} valve? It will close automatically after 10 minutes.`}
          onConfirm={() => { sendCommand(pending.action); setPending(null) }}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  )
}

export default function Control() {
  return (
    <div style={styles.page}>
      <p style={styles.note}>
        OPEN commands require confirmation. Valves close automatically after 10 minutes.
      </p>
      {ZONES.map(z => (
        <ZoneControl key={z.id} zoneId={z.id} label={z.label} />
      ))}
    </div>
  )
}

const styles = {
  page:          { display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' },
  note:          { color: '#7aab90', fontSize: '0.82rem', margin: 0 },
  card:          { background: '#1e2d24', borderRadius: '12px', padding: '1.25rem' },
  header:        { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
  label:         { color: '#e0f0e8', fontSize: '1.1rem', fontWeight: 600 },
  badge:         { color: '#fff', fontSize: '0.75rem', fontWeight: 700, padding: '0.25rem 0.6rem', borderRadius: '6px' },
  pendingBanner: { background: '#2a3d2e', color: '#e0b03a', fontSize: '0.8rem', padding: '0.5rem 0.75rem', borderRadius: '6px', marginBottom: '0.75rem' },
  btnRow:        { display: 'flex', gap: '0.75rem' },
  btn:           { flex: 1, padding: '0.8rem', borderRadius: '10px', border: 'none', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer', transition: 'opacity 0.2s' },
  btnOpen:       { background: '#e05c3a', color: '#fff' },
  btnClose:      { background: '#2e4a38', color: '#a0c8b0' }
}
