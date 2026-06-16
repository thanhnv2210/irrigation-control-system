import { useState, useEffect } from 'react'
import { ref, set, onValue } from 'firebase/database'
import { db, auth } from '../firebase'
import { useSite } from '../context/SiteContext'
import { useAuth } from '../App'
import { useDeviceData } from '../hooks/useZoneData'

const INTERVAL_PRESETS = [
  { label: '10s', ms: 10000  },
  { label: '30s', ms: 30000  },
  { label: '1m',  ms: 60000  },
  { label: '2m',  ms: 120000 },
  { label: '5m',  ms: 300000 },
]

// ── User Profile ─────────────────────────────────────────────────────────────
function UserProfile() {
  const user = auth.currentUser
  if (!user) return null

  const joined   = user.metadata?.creationTime  ? new Date(user.metadata.creationTime).toLocaleDateString()  : '—'
  const lastLogin = user.metadata?.lastSignInTime ? new Date(user.metadata.lastSignInTime).toLocaleString() : '—'

  return (
    <div style={styles.card}>
      <span style={styles.cardTitle}>User Profile</span>
      <div style={styles.fieldList}>
        <div style={styles.field}>
          <span style={styles.fieldLabel}>Email</span>
          <span style={styles.fieldValue}>{user.email}</span>
        </div>
        {user.displayName && (
          <div style={styles.field}>
            <span style={styles.fieldLabel}>Name</span>
            <span style={styles.fieldValue}>{user.displayName}</span>
          </div>
        )}
        <div style={styles.field}>
          <span style={styles.fieldLabel}>UID</span>
          <span style={{ ...styles.fieldValue, ...styles.mono }}>{user.uid}</span>
        </div>
        <div style={styles.field}>
          <span style={styles.fieldLabel}>Account created</span>
          <span style={styles.fieldValue}>{joined}</span>
        </div>
        <div style={styles.field}>
          <span style={styles.fieldLabel}>Last sign-in</span>
          <span style={styles.fieldValue}>{lastLogin}</span>
        </div>
      </div>
      <p style={styles.hint}>To sign out, open the ☰ menu.</p>
    </div>
  )
}

// ── Site Management ───────────────────────────────────────────────────────────
function SiteManagement() {
  const { siteId, setSiteId, sites, createSite, renameSite, deleteSite } = useSite()
  const [newName,    setNewName]    = useState('')
  const [creating,   setCreating]   = useState(false)
  const [renamingId, setRenamingId] = useState(null)
  const [editName,   setEditName]   = useState('')

  const siteList = Object.entries(sites)

  async function handleCreate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    await createSite(newName.trim())
    setNewName('')
    setCreating(false)
  }

  async function handleRename(e) {
    e.preventDefault()
    if (!editName.trim()) return
    await renameSite(renamingId, editName.trim())
    setRenamingId(null)
  }

  async function handleDelete(id) {
    const name = sites[id]?.meta?.name || id
    if (!confirm(`Delete "${name}"? This removes all its data permanently.`)) return
    await deleteSite(id)
  }

  return (
    <div style={styles.card}>
      <span style={styles.cardTitle}>Site Management</span>
      <p style={styles.hint}>
        Each site is an independent location with its own zones, schedules, and device.
        Switch the active site using the header selector.
      </p>
      <div style={styles.siteList}>
        {siteList.map(([id, s]) => {
          const name       = s?.meta?.name || id
          const isActive   = id === siteId
          const isRenaming = renamingId === id
          return (
            <div key={id} style={{ ...styles.siteRow, borderColor: isActive ? '#1a7f4b' : '#2e4a38' }}>
              <span style={{ ...styles.activeDot, background: isActive ? '#1a7f4b' : 'transparent', border: isActive ? 'none' : '1px solid #3a5a45' }} />
              {isRenaming ? (
                <form onSubmit={handleRename} style={styles.inlineForm}>
                  <input autoFocus style={styles.inlineInput} value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => e.key === 'Escape' && setRenamingId(null)} />
                  <button style={styles.inlineSave} type="submit">✓</button>
                  <button style={styles.inlineCancel} type="button" onClick={() => setRenamingId(null)}>✕</button>
                </form>
              ) : (
                <>
                  <button style={{ ...styles.siteName, ...(isActive ? styles.siteNameActive : {}) }} onClick={() => setSiteId(id)}>
                    {name}
                    {isActive && <span style={styles.activePill}>active</span>}
                  </button>
                  <div style={styles.siteActions}>
                    <button style={styles.iconBtn} onClick={() => { setRenamingId(id); setEditName(name) }} title="Rename">✎</button>
                    <button style={{ ...styles.iconBtn, ...styles.iconBtnDanger }} onClick={() => handleDelete(id)} title="Delete site">🗑</button>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
      {creating ? (
        <form onSubmit={handleCreate} style={styles.addForm}>
          <input autoFocus style={styles.addInput} placeholder="New site name…"
            value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && setCreating(false)} />
          <button style={{ ...styles.btn, background: '#1a7f4b' }} type="submit">Add</button>
          <button style={{ ...styles.btn, background: 'transparent', border: '1px solid #3a5a45', color: '#7aab90' }} type="button" onClick={() => setCreating(false)}>Cancel</button>
        </form>
      ) : (
        <button style={{ ...styles.btn, background: '#1a7f4b', marginTop: '0.75rem' }} onClick={() => setCreating(true)}>
          + Add Site
        </button>
      )}
    </div>
  )
}

// ── Device Configuration ──────────────────────────────────────────────────────
function DeviceCard({ deviceId }) {
  const { sitePath, zones, renameDevice, renameZone } = useSite()
  const device      = useDeviceData(deviceId)
  const deviceZones = zones.filter(z => z.deviceId === deviceId)

  const [open,          setOpen]          = useState(false)
  const [configMs,      setConfigMs]      = useState(null)
  const [sensorEnabled, setSensorEnabled] = useState({})
  const [saving,        setSaving]        = useState(false)
  const [renamingCtrl,  setRenamingCtrl]  = useState(false)
  const [renamingZone,  setRenamingZone]  = useState(null)
  const [editName,      setEditName]      = useState('')

  useEffect(() => {
    if (!deviceId) return
    const unsubInterval = onValue(
      ref(db, sitePath(`devices/${deviceId}/config/sensorIntervalMs`)),
      snap => setConfigMs(snap.val())
    )
    const unsubEnabled = onValue(
      ref(db, sitePath(`devices/${deviceId}/config/sensorEnabled`)),
      snap => setSensorEnabled(snap.val() ?? {})
    )
    return () => { unsubInterval(); unsubEnabled() }
  }, [deviceId, sitePath])

  async function applyInterval(ms) {
    setSaving(true)
    await set(ref(db, sitePath(`devices/${deviceId}/config/sensorIntervalMs`)), ms)
    setSaving(false)
  }

  async function toggleSensor(zoneId, enabled) {
    await set(ref(db, sitePath(`devices/${deviceId}/config/sensorEnabled/${zoneId}`)), enabled)
  }

  async function handleRenameCtrl(e) {
    e.preventDefault()
    if (!editName.trim()) return
    await renameDevice(deviceId, editName.trim())
    setRenamingCtrl(false)
  }

  async function handleRenameZone(e, zoneId) {
    e.preventDefault()
    if (!editName.trim()) return
    await renameZone(zoneId, deviceId, editName.trim())
    setRenamingZone(null)
  }

  function fmt(ms) {
    if (!ms) return null
    return ms < 60000 ? `${ms / 1000}s` : `${ms / 60000}m`
  }

  const displayName        = device?.name || deviceId
  const reportedIntervalMs = device?.sensorIntervalMs ?? null

  const disabledCount = deviceZones.filter(z => sensorEnabled[z.id] === false).length
  const summary = [
    configMs ? `interval ${fmt(configMs)}` : null,
    disabledCount > 0 ? `${disabledCount} sensor${disabledCount > 1 ? 's' : ''} off` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div style={styles.card}>
      {/* Collapsible header */}
      <button style={styles.collapseBtn} onClick={() => setOpen(o => !o)}>
        <span style={styles.cardTitle}>{displayName}</span>
        {!open && summary && <span style={styles.collapseSummary}>{summary}</span>}
        <span style={styles.collapseChevron}>{open ? '▲' : '▼'}</span>
      </button>

      {!open && <div style={styles.collapseDivider} />}

      {open && <>
      {/* Controller name */}
      <div style={styles.cfgRow}>
        <span style={styles.cfgLabel}>Controller name</span>
        {renamingCtrl ? (
          <form onSubmit={handleRenameCtrl} style={styles.inlineForm}>
            <input autoFocus style={styles.inlineInput} value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && setRenamingCtrl(false)} />
            <button style={styles.inlineSave} type="submit">✓</button>
            <button style={styles.inlineCancel} type="button" onClick={() => setRenamingCtrl(false)}>✕</button>
          </form>
        ) : (
          <div style={styles.cfgRight}>
            <span style={styles.cfgValue}>{displayName}</span>
            <button style={styles.iconBtn} onClick={() => { setEditName(displayName); setRenamingCtrl(true) }}>✎</button>
          </div>
        )}
      </div>

      {/* Sensor interval */}
      <div style={styles.cfgRow}>
        <span style={styles.cfgLabel}>Sensor interval</span>
        <div style={styles.cfgRight}>
          {configMs && (
            <span style={styles.cfgMuted}>
              {fmt(configMs)}
              {reportedIntervalMs && reportedIntervalMs !== configMs &&
                <span style={{ color: '#e0b03a' }}> · device {fmt(reportedIntervalMs)}</span>
              }
            </span>
          )}
          <div style={styles.presetRow}>
            {INTERVAL_PRESETS.map(p => (
              <button key={p.ms} disabled={saving}
                style={{ ...styles.presetBtn, ...(configMs === p.ms ? styles.presetActive : {}) }}
                onClick={() => applyInterval(p.ms)}
              >{p.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Per-zone rows */}
      {deviceZones.map(z => {
        const enabled    = sensorEnabled[z.id] ?? null
        const isRenaming = renamingZone === z.id
        return (
          <div key={z.id} style={styles.zoneBlock}>
            <span style={styles.zoneBlockTitle}>{z.label}</span>

            {/* Zone name */}
            <div style={styles.cfgRow}>
              <span style={styles.cfgLabel}>Zone name</span>
              {isRenaming ? (
                <form onSubmit={e => handleRenameZone(e, z.id)} style={styles.inlineForm}>
                  <input autoFocus style={styles.inlineInput} value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => e.key === 'Escape' && setRenamingZone(null)} />
                  <button style={styles.inlineSave} type="submit">✓</button>
                  <button style={styles.inlineCancel} type="button" onClick={() => setRenamingZone(null)}>✕</button>
                </form>
              ) : (
                <div style={styles.cfgRight}>
                  <span style={styles.cfgValue}>{z.label}</span>
                  <button style={styles.iconBtn} onClick={() => { setEditName(z.label); setRenamingZone(z.id) }}>✎</button>
                </div>
              )}
            </div>

            {/* Sensor toggle */}
            <div style={styles.cfgRow}>
              <span style={styles.cfgLabel}>Sensor</span>
              <div style={styles.cfgRight}>
                {enabled === null
                  ? <span style={styles.cfgMuted}>not set</span>
                  : <span style={{ ...styles.cfgMuted, color: enabled ? '#1a7f4b' : '#e05c3a' }}>
                      {enabled ? 'enabled' : 'disabled'}
                    </span>
                }
                <div style={styles.presetRow}>
                  <button
                    style={{ ...styles.presetBtn, ...(enabled === true  ? styles.presetActive : {}) }}
                    onClick={() => toggleSensor(z.id, true)}
                  >On</button>
                  <button
                    style={{ ...styles.presetBtn, ...(enabled === false ? styles.presetDanger : {}) }}
                    onClick={() => toggleSensor(z.id, false)}
                  >Off</button>
                </div>
              </div>
            </div>
          </div>
        )
      })}
      </>}
    </div>
  )
}

function DeviceConfiguration() {
  const { devices } = useSite()
  if (devices.length === 0) return null
  return <>{devices.map(d => <DeviceCard key={d.id} deviceId={d.id} />)}</>
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function Settings() {
  const { isGuest } = useAuth()
  return (
    <div style={styles.page}>
      <UserProfile />
      {!isGuest && <DeviceConfiguration />}
      {!isGuest && <SiteManagement />}
    </div>
  )
}

const styles = {
  page:          { display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' },
  card:          { background: '#1e2d24', borderRadius: '12px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  cardTitle:     { color: '#e0f0e8', fontSize: '1rem', fontWeight: 700 },
  hint:          { color: '#7aab90', fontSize: '0.8rem', margin: 0 },

  // User profile
  fieldList:     { display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  field:         { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem', borderBottom: '1px solid #2e4a38', paddingBottom: '0.35rem' },
  fieldLabel:    { color: '#7aab90', fontSize: '0.78rem', flexShrink: 0 },
  fieldValue:    { color: '#e0f0e8', fontSize: '0.82rem', textAlign: 'right', wordBreak: 'break-all' },
  mono:          { fontFamily: 'monospace', fontSize: '0.72rem', color: '#a0c8b0' },

  // Site management
  siteList:      { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  siteRow:       { display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#162a1e', borderRadius: '8px', padding: '0.6rem 0.75rem', border: '1px solid #2e4a38' },
  activeDot:     { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  siteName:      { flex: 1, background: 'transparent', border: 'none', color: '#a0c8b0', fontSize: '0.9rem', fontWeight: 500, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: 0 },
  siteNameActive:{ color: '#e0f0e8', fontWeight: 600 },
  activePill:    { background: '#1a3d28', color: '#1a7f4b', fontSize: '0.65rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: '4px', border: '1px solid #1a7f4b' },
  siteActions:   { display: 'flex', gap: '0.3rem', flexShrink: 0 },
  iconBtnDanger: { borderColor: '#e05c3a', color: '#e05c3a' },
  addForm:       { display: 'flex', gap: '0.4rem', marginTop: '0.75rem' },
  addInput:      { background: '#0f1f15', border: '1px solid #3a5a45', borderRadius: '8px', color: '#e0f0e8', fontSize: '0.9rem', padding: '0.45rem 0.75rem', flex: 1, outline: 'none' },
  btn:           { padding: '0.45rem 0.9rem', borderRadius: '8px', border: 'none', color: '#fff', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', flexShrink: 0 },

  // Device card collapse
  collapseBtn:     { display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, width: '100%', textAlign: 'left' },
  collapseSummary: { color: '#3a5a45', fontSize: '0.75rem', flex: 1 },
  collapseChevron: { color: '#3a5a45', fontSize: '0.65rem', marginLeft: 'auto', flexShrink: 0 },
  collapseDivider: { height: '1px', background: '#2e4a38', marginTop: '0.25rem' },

  // Device config
  cfgRow:        { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', minHeight: '2rem', borderTop: '1px solid #2e4a38', paddingTop: '0.5rem' },
  cfgLabel:      { color: '#7aab90', fontSize: '0.78rem', flexShrink: 0, minWidth: '110px' },
  cfgRight:      { display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, flexWrap: 'wrap' },
  cfgValue:      { color: '#e0f0e8', fontSize: '0.85rem', flex: 1 },
  cfgMuted:      { color: '#a0c8b0', fontSize: '0.78rem' },
  zoneBlock:     { background: '#162a1e', borderRadius: '8px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  zoneBlockTitle:{ color: '#e0f0e8', fontSize: '0.88rem', fontWeight: 600 },
  presetRow:     { display: 'flex', gap: '0.3rem', marginLeft: 'auto' },
  presetBtn:     { padding: '0.3rem 0.65rem', borderRadius: '6px', border: '1px solid #3a5a45', background: 'transparent', color: '#7aab90', fontSize: '0.78rem', cursor: 'pointer' },
  presetActive:  { background: '#1a7f4b', color: '#fff', borderColor: '#1a7f4b' },
  presetDanger:  { background: '#e05c3a', color: '#fff', borderColor: '#e05c3a' },

  // Shared inline rename
  iconBtn:       { background: 'transparent', border: '1px solid #3a5a45', borderRadius: '6px', color: '#7aab90', fontSize: '0.85rem', padding: '0.4rem 0.6rem', cursor: 'pointer', flexShrink: 0 },
  inlineForm:    { display: 'flex', alignItems: 'center', gap: '0.4rem', flex: 1 },
  inlineInput:   { background: '#0f1f15', border: '1px solid #3a5a45', borderRadius: '6px', color: '#e0f0e8', fontSize: '0.95rem', padding: '0.4rem 0.6rem', flex: 1, outline: 'none' },
  inlineSave:    { background: '#1a7f4b', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '0.85rem', padding: '0.4rem 0.6rem', cursor: 'pointer' },
  inlineCancel:  { background: 'transparent', border: '1px solid #3a5a45', borderRadius: '6px', color: '#7aab90', fontSize: '0.85rem', padding: '0.4rem 0.6rem', cursor: 'pointer' },
}
