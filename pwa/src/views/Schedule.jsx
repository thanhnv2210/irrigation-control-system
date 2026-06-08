import { useState } from 'react'
import { ref, set, remove, push } from 'firebase/database'
import { db } from '../firebase'
import { useZoneData } from '../hooks/useZoneData'
import { logAudit } from '../utils/audit'
import { useSite } from '../context/SiteContext'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const EMPTY_FORM = { hour: 6, minute: 0, durationMinutes: 10, enabled: true, days: [1,2,3,4,5] }

function ScheduleForm({ zoneId, initial, onDone }) {
  const { sitePath } = useSite()
  const [form, setForm] = useState(initial ?? EMPTY_FORM)

  function toggleDay(d) {
    setForm(f => ({
      ...f,
      days: f.days.includes(d) ? f.days.filter(x => x !== d) : [...f.days, d].sort()
    }))
  }

  async function save() {
    if (form.days.length === 0) return alert('Select at least one day')
    const isNew    = !initial?._id
    const baseRef  = ref(db, sitePath(`zones/${zoneId}/schedule`))
    const entryRef = isNew ? push(baseRef) : ref(db, sitePath(`zones/${zoneId}/schedule/${initial._id}`))
    const entry = {
      hour:            Number(form.hour),
      minute:          Number(form.minute),
      durationMinutes: Number(form.durationMinutes),
      enabled:         form.enabled,
      days:            form.days
    }
    await set(entryRef, entry)
    logAudit(sitePath, 'SCHEDULE_SAVED', zoneId, { ...entry, isNew })
    onDone()
  }

  return (
    <div style={styles.form}>
      <div style={styles.row}>
        <label style={styles.lbl}>Hour (0–23)</label>
        <input style={styles.input} type="number" min="0" max="23"
          value={form.hour} onChange={e => setForm(f => ({ ...f, hour: e.target.value }))} />
      </div>
      <div style={styles.row}>
        <label style={styles.lbl}>Minute</label>
        <input style={styles.input} type="number" min="0" max="59"
          value={form.minute} onChange={e => setForm(f => ({ ...f, minute: e.target.value }))} />
      </div>
      <div style={styles.row}>
        <label style={styles.lbl}>Duration (min)</label>
        <input style={styles.input} type="number" min="1" max="10"
          value={form.durationMinutes} onChange={e => setForm(f => ({ ...f, durationMinutes: e.target.value }))} />
      </div>
      <div style={styles.daysRow}>
        {DAY_LABELS.map((d, i) => (
          <button key={i}
            style={{ ...styles.dayBtn, ...(form.days.includes(i) ? styles.dayActive : {}) }}
            onClick={() => toggleDay(i)}>{d}</button>
        ))}
      </div>
      <div style={styles.row}>
        <label style={styles.lbl}>Enabled</label>
        <input type="checkbox" checked={form.enabled}
          onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
      </div>
      <div style={styles.formActions}>
        <button style={styles.cancelBtn} onClick={onDone}>Cancel</button>
        <button style={styles.saveBtn} onClick={save}>Save</button>
      </div>
    </div>
  )
}

function ScheduleItem({ zoneId, id, entry, onEdit }) {
  const { sitePath } = useSite()
  const days = (entry.days ?? []).map(d => DAY_LABELS[d]).join(', ')
  const time = `${String(entry.hour).padStart(2,'0')}:${String(entry.minute).padStart(2,'0')}`

  async function toggle() {
    await set(ref(db, sitePath(`zones/${zoneId}/schedule/${id}/enabled`)), !entry.enabled)
    logAudit(sitePath, 'SCHEDULE_TOGGLED', zoneId, { scheduleId: id, hour: entry.hour, minute: entry.minute, enabled: !entry.enabled })
  }
  async function del() {
    await remove(ref(db, sitePath(`zones/${zoneId}/schedule/${id}`)))
    logAudit(sitePath, 'SCHEDULE_DELETED', zoneId, { scheduleId: id, hour: entry.hour, minute: entry.minute })
  }

  return (
    <div style={{ ...styles.item, opacity: entry.enabled ? 1 : 0.5 }}>
      <div style={styles.itemInfo}>
        <span style={styles.itemTime}>{time}</span>
        <span style={styles.itemMeta}>{entry.durationMinutes} min — {days}</span>
      </div>
      <div style={styles.itemActions}>
        <button style={styles.iconBtn} onClick={toggle}>{entry.enabled ? 'Disable' : 'Enable'}</button>
        <button style={styles.iconBtn} onClick={() => onEdit({ ...entry, _id: id })}>Edit</button>
        <button style={{ ...styles.iconBtn, color: '#e05c3a' }} onClick={del}>Delete</button>
      </div>
    </div>
  )
}

function ZoneSchedule({ zoneId, label }) {
  const { schedule } = useZoneData(zoneId)
  const [editing, setEditing] = useState(null)  // null | {} | { _id, ...entry }

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <span style={styles.zoneName}>{label}</span>
        <button style={styles.addBtn} onClick={() => setEditing({})}>+ Add</button>
      </div>

      {editing !== null && (
        <ScheduleForm zoneId={zoneId} initial={editing._id ? editing : null} onDone={() => setEditing(null)} />
      )}

      {Object.keys(schedule).length === 0 && editing === null && (
        <p style={styles.empty}>No schedules — tap + Add to create one.</p>
      )}

      {Object.entries(schedule).map(([id, entry]) => (
        <ScheduleItem key={id} zoneId={zoneId} id={id} entry={entry} onEdit={setEditing} />
      ))}
    </div>
  )
}

export default function Schedule() {
  const { zones } = useSite()
  return (
    <div style={styles.page}>
      {zones.length === 0 && (
        <p style={{ color: '#3a5a45', fontSize: '0.9rem', textAlign: 'center', marginTop: '2rem' }}>
          No zones configured for this site.
        </p>
      )}
      {zones.map(z => <ZoneSchedule key={z.id} zoneId={z.id} label={z.label} />)}
    </div>
  )
}

const styles = {
  page:        { display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' },
  card:        { background: '#1e2d24', borderRadius: '12px', padding: '1.25rem' },
  cardHeader:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
  zoneName:    { color: '#e0f0e8', fontSize: '1.1rem', fontWeight: 600 },
  addBtn:      { background: '#1a7f4b', color: '#fff', border: 'none', borderRadius: '8px', padding: '0.4rem 0.9rem', fontWeight: 600, cursor: 'pointer' },
  empty:       { color: '#7aab90', fontSize: '0.85rem', textAlign: 'center', padding: '1rem 0' },
  item:        { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 0', borderTop: '1px solid #2e4a38' },
  itemInfo:    { display: 'flex', flexDirection: 'column', gap: '0.2rem' },
  itemTime:    { color: '#e0f0e8', fontWeight: 600, fontSize: '1rem' },
  itemMeta:    { color: '#7aab90', fontSize: '0.78rem' },
  itemActions: { display: 'flex', gap: '0.5rem' },
  iconBtn:     { background: 'transparent', border: '1px solid #3a5a45', color: '#a0c8b0', borderRadius: '6px', padding: '0.3rem 0.6rem', fontSize: '0.75rem', cursor: 'pointer' },
  form:        { background: '#162a1e', borderRadius: '10px', padding: '1rem', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  row:         { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  lbl:         { color: '#a0c8b0', fontSize: '0.85rem' },
  input:       { background: '#1e2d24', border: '1px solid #3a5a45', color: '#e0f0e8', borderRadius: '6px', padding: '0.4rem 0.6rem', width: '80px', fontSize: '0.9rem' },
  daysRow:     { display: 'flex', gap: '0.4rem', flexWrap: 'wrap' },
  dayBtn:      { padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid #3a5a45', background: 'transparent', color: '#7aab90', fontSize: '0.75rem', cursor: 'pointer' },
  dayActive:   { background: '#1a7f4b', color: '#fff', borderColor: '#1a7f4b' },
  formActions: { display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' },
  cancelBtn:   { padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid #3a5a45', background: 'transparent', color: '#a0c8b0', cursor: 'pointer' },
  saveBtn:     { padding: '0.5rem 1rem', borderRadius: '8px', border: 'none', background: '#1a7f4b', color: '#fff', fontWeight: 600, cursor: 'pointer' }
}
