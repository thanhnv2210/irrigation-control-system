import { useState, useEffect } from 'react'
import { ref, query, orderByChild, limitToLast, onValue } from 'firebase/database'
import { db } from '../firebase'

const ACTION_META = {
  VALVE_COMMAND:     { icon: '💧', label: 'Valve Command',     color: '#3a8fd4' },
  SCHEDULE_SAVED:    { icon: '📅', label: 'Schedule Saved',    color: '#1a7f4b' },
  SCHEDULE_DELETED:  { icon: '🗑', label: 'Schedule Deleted',  color: '#e05c3a' },
  SCHEDULE_TOGGLED:  { icon: '🔄', label: 'Schedule Toggled',  color: '#e0b03a' },
  SCHEDULE_FIRED:    { icon: '⚡', label: 'Schedule Fired',    color: '#a06fd4' },
}

const FILTERS = [
  { id: 'all',      label: 'All' },
  { id: 'valve',    label: 'Valve',    match: ['VALVE_COMMAND'] },
  { id: 'schedule', label: 'Schedule', match: ['SCHEDULE_SAVED', 'SCHEDULE_DELETED', 'SCHEDULE_TOGGLED', 'SCHEDULE_FIRED'] },
]

function timeAgo(ts) {
  const diff = Date.now() - ts
  const min  = Math.floor(diff / 60000)
  const hr   = Math.floor(diff / 3600000)
  const day  = Math.floor(diff / 86400000)
  if (min < 1)  return 'just now'
  if (min < 60) return `${min}m ago`
  if (hr  < 24) return `${hr}h ago`
  return new Date(ts).toLocaleDateString()
}

function detailSummary(action, details, zone) {
  const z = zone ? `[${zone}] ` : ''
  switch (action) {
    case 'VALVE_COMMAND':
      return `${z}${details.action}`
    case 'SCHEDULE_SAVED':
      return `${z}${String(details.hour).padStart(2,'0')}:${String(details.minute).padStart(2,'0')} · ${details.durationMinutes} min · ${details.isNew ? 'new' : 'updated'}`
    case 'SCHEDULE_DELETED':
      return `${z}${String(details.hour).padStart(2,'0')}:${String(details.minute).padStart(2,'0')} removed`
    case 'SCHEDULE_TOGGLED':
      return `${z}${String(details.hour).padStart(2,'0')}:${String(details.minute).padStart(2,'0')} → ${details.enabled ? 'enabled' : 'disabled'}`
    case 'SCHEDULE_FIRED':
      return `${z}${String(details.hour).padStart(2,'0')}:${String(details.minute).padStart(2,'0')} fired manually`
    default:
      return z + JSON.stringify(details)
  }
}

export default function AuditLog() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState('all')

  useEffect(() => {
    const q = query(
      ref(db, 'irrigation/auditLog'),
      orderByChild('timestamp'),
      limitToLast(100)
    )
    const unsub = onValue(q, snap => {
      if (!snap.exists()) { setEntries([]); setLoading(false); return }
      const list = Object.entries(snap.val())
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => b.timestamp - a.timestamp)
      setEntries(list)
      setLoading(false)
    })
    return unsub
  }, [])

  const filterCfg = FILTERS.find(f => f.id === filter)
  const visible = filter === 'all'
    ? entries
    : entries.filter(e => filterCfg.match.includes(e.action))

  return (
    <div style={styles.page}>
      {/* Filter bar */}
      <div style={styles.filterRow}>
        {FILTERS.map(f => (
          <button
            key={f.id}
            style={{ ...styles.filterBtn, ...(filter === f.id ? styles.filterActive : {}) }}
            onClick={() => setFilter(f.id)}
          >{f.label}</button>
        ))}
        <span style={styles.count}>{visible.length} entries</span>
      </div>

      {loading && <div style={styles.empty}>Loading…</div>}

      {!loading && visible.length === 0 && (
        <div style={styles.empty}>
          No activity yet — actions in Control, Schedule, and Simulator tabs are logged here.
        </div>
      )}

      {visible.map(e => {
        const meta = ACTION_META[e.action] ?? { icon: '•', label: e.action, color: '#7aab90' }
        return (
          <div key={e.id} style={styles.entry}>
            <span style={styles.entryIcon}>{meta.icon}</span>
            <div style={styles.entryBody}>
              <div style={styles.entryTop}>
                <span style={{ ...styles.entryAction, color: meta.color }}>{meta.label}</span>
                <span style={styles.entryTime}>{timeAgo(e.timestamp)}</span>
              </div>
              <span style={styles.entryDetail}>{detailSummary(e.action, e.details ?? {}, e.zone)}</span>
              <span style={styles.entryUser}>{e.user}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

const styles = {
  page:         { display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem' },
  filterRow:    { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' },
  filterBtn:    { padding: '0.35rem 0.85rem', borderRadius: '8px', border: '1px solid #3a5a45', background: 'transparent', color: '#7aab90', fontSize: '0.82rem', cursor: 'pointer' },
  filterActive: { background: '#1a7f4b', color: '#fff', borderColor: '#1a7f4b' },
  count:        { marginLeft: 'auto', color: '#3a5a45', fontSize: '0.75rem' },
  empty:        { color: '#7aab90', fontSize: '0.85rem', textAlign: 'center', padding: '3rem 0' },
  entry:        { display: 'flex', gap: '0.75rem', background: '#1e2d24', borderRadius: '10px', padding: '0.85rem 1rem', alignItems: 'flex-start' },
  entryIcon:    { fontSize: '1.1rem', lineHeight: 1, flexShrink: 0, marginTop: '0.1rem' },
  entryBody:    { display: 'flex', flexDirection: 'column', gap: '0.2rem', flex: 1, minWidth: 0 },
  entryTop:     { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' },
  entryAction:  { fontWeight: 600, fontSize: '0.85rem' },
  entryTime:    { color: '#3a5a45', fontSize: '0.75rem', flexShrink: 0 },
  entryDetail:  { color: '#e0f0e8', fontSize: '0.82rem' },
  entryUser:    { color: '#3a5a45', fontSize: '0.72rem' },
}
