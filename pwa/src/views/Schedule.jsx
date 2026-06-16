import { useState } from 'react'
import { ref, set, remove, push } from 'firebase/database'
import { db } from '../firebase'
import { useZoneData, useDeviceData } from '../hooks/useZoneData'
import { logAudit } from '../utils/audit'
import { useSite } from '../context/SiteContext'
import { useAuth } from '../App'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const EMPTY_FORM = { hour: 6, minute: 0, durationMinutes: 10, enabled: true, days: [1,2,3,4,5] }

function ScheduleForm({ zoneId, deviceId, initial, onDone }) {
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
    const baseRef  = ref(db, sitePath(`devices/${deviceId}/zones/${zoneId}/schedule`))
    const entryRef = isNew ? push(baseRef) : ref(db, sitePath(`devices/${deviceId}/zones/${zoneId}/schedule/${initial._id}`))
    const entry = {
      hour:            Number(form.hour),
      minute:          Number(form.minute),
      durationMinutes: Number(form.durationMinutes),
      enabled:         form.enabled,
      days:            form.days
    }
    await set(entryRef, entry)
    logAudit(sitePath, 'SCHEDULE_SAVED', `${deviceId}/${zoneId}`, { ...entry, isNew })
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

function ScheduleItem({ zoneId, deviceId, id, entry, onEdit }) {
  const { sitePath } = useSite()
  const days = (entry.days ?? []).map(d => DAY_LABELS[d]).join(', ')
  const time = `${String(entry.hour).padStart(2,'0')}:${String(entry.minute).padStart(2,'0')}`

  async function toggle() {
    await set(ref(db, sitePath(`devices/${deviceId}/zones/${zoneId}/schedule/${id}/enabled`)), !entry.enabled)
    logAudit(sitePath, 'SCHEDULE_TOGGLED', `${deviceId}/${zoneId}`, { scheduleId: id, hour: entry.hour, minute: entry.minute, enabled: !entry.enabled })
  }
  async function del() {
    await remove(ref(db, sitePath(`devices/${deviceId}/zones/${zoneId}/schedule/${id}`)))
    logAudit(sitePath, 'SCHEDULE_DELETED', `${deviceId}/${zoneId}`, { scheduleId: id, hour: entry.hour, minute: entry.minute })
  }

  return (
    <div style={{ ...styles.item, opacity: entry.enabled ? 1 : 0.5 }}>
      <div style={styles.itemInfo}>
        <span style={styles.itemTime}>{time}</span>
        <span style={styles.itemMeta}>{entry.durationMinutes} min — {days}</span>
      </div>
      {onEdit && (
        <div style={styles.itemActions}>
          <button style={styles.iconBtn} onClick={toggle}>{entry.enabled ? 'Disable' : 'Enable'}</button>
          <button style={styles.iconBtn} onClick={() => onEdit({ ...entry, _id: id })}>Edit</button>
          <button style={{ ...styles.iconBtn, color: '#e05c3a' }} onClick={del}>Delete</button>
        </div>
      )}
    </div>
  )
}

function useDeviceOnline(deviceId) {
  const device = useDeviceData(deviceId)
  const age                = device?.lastSeen ? Math.floor((Date.now() - device.lastSeen) / 1000) : null
  const heartbeatMs        = device?.heartbeatIntervalMs ?? 60000
  const onlineThresholdSec = Math.ceil((heartbeatMs * 2) / 1000)
  return age !== null && age < onlineThresholdSec
}

function ZoneSchedule({ zoneId, deviceId, label }) {
  const { schedule } = useZoneData({ zoneId, deviceId })
  const { isGuest } = useAuth()
  const online = useDeviceOnline(deviceId)
  const [editing, setEditing] = useState(null)  // null | {} | { _id, ...entry }

  const canEdit = !isGuest && online

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <span style={styles.zoneName}>{label}</span>
        {canEdit && <button style={styles.addBtn} onClick={() => setEditing({})}>+ Add</button>}
      </div>

      {!online && (
        <div style={styles.offlineBanner}>Device offline — schedule editing disabled</div>
      )}

      {editing !== null && (
        <ScheduleForm zoneId={zoneId} deviceId={deviceId} initial={editing._id ? editing : null} onDone={() => setEditing(null)} />
      )}

      {Object.keys(schedule).length === 0 && editing === null && (
        <p style={styles.empty}>No schedules{canEdit ? ' — tap + Add to create one.' : '.'}</p>
      )}

      {Object.entries(schedule).map(([id, entry]) => (
        <ScheduleItem key={id} zoneId={zoneId} deviceId={deviceId} id={id} entry={entry}
          onEdit={canEdit ? setEditing : null} />
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
      {zones.map(z => <ZoneSchedule key={z.id} zoneId={z.id} deviceId={z.deviceId} label={z.label} />)}
    </div>
  )
}

const styles = {
  page:        { display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' },
  card:        { background: '#1e2d24', borderRadius: '12px', padding: '1.25rem' },
  cardHeader:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
  zoneName:    { color: '#e0f0e8', fontSize: '1.1rem', fontWeight: 600 },
  addBtn:      { background: '#1a7f4b', color: '#fff', border: 'none', borderRadius: '8px', padding: '0.55rem 1.1rem', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' },
  offlineBanner: { background: '#2a1a1a', color: '#e05c3a', fontSize: '0.85rem', padding: '0.6rem 0.85rem', borderRadius: '8px', marginBottom: '0.75rem' },
  empty:       { color: '#7aab90', fontSize: '0.88rem', textAlign: 'center', padding: '1rem 0' },
  item:        { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.9rem 0', borderTop: '1px solid #2e4a38', gap: '0.5rem' },
  itemInfo:    { display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  itemTime:    { color: '#e0f0e8', fontWeight: 600, fontSize: '1rem' },
  itemMeta:    { color: '#7aab90', fontSize: '0.82rem' },
  itemActions: { display: 'flex', gap: '0.4rem', flexShrink: 0 },
  iconBtn:     { background: 'transparent', border: '1px solid #3a5a45', color: '#a0c8b0', borderRadius: '8px', padding: '0.5rem 0.75rem', fontSize: '0.82rem', cursor: 'pointer' },
  form:        { background: '#162a1e', borderRadius: '10px', padding: '1rem', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' },
  row:         { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  lbl:         { color: '#a0c8b0', fontSize: '0.88rem' },
  input:       { background: '#1e2d24', border: '1px solid #3a5a45', color: '#e0f0e8', borderRadius: '8px', padding: '0.6rem 0.75rem', width: '90px', fontSize: '1rem' },
  daysRow:     { display: 'flex', gap: '0.4rem', flexWrap: 'wrap' },
  dayBtn:      { padding: '0.55rem 0.65rem', borderRadius: '8px', border: '1px solid #3a5a45', background: 'transparent', color: '#7aab90', fontSize: '0.82rem', cursor: 'pointer' },
  dayActive:   { background: '#1a7f4b', color: '#fff', borderColor: '#1a7f4b' },
  formActions: { display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' },
  cancelBtn:   { padding: '0.65rem 1.1rem', borderRadius: '8px', border: '1px solid #3a5a45', background: 'transparent', color: '#a0c8b0', fontSize: '0.9rem', cursor: 'pointer' },
  saveBtn:     { padding: '0.65rem 1.1rem', borderRadius: '8px', border: 'none', background: '#1a7f4b', color: '#fff', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' }
}
