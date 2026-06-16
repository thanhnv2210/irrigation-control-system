import { useState, useEffect } from 'react'
import { ref, set, onValue } from 'firebase/database'
import { db } from '../firebase'
import { useZoneData, useDeviceData } from '../hooks/useZoneData'
import { useSite } from '../context/SiteContext'
import { useAuth } from '../App'

const INTERVAL_PRESETS = [
  { label: '10s', ms: 10000  },
  { label: '30s', ms: 30000  },
  { label: '1m',  ms: 60000  },
  { label: '2m',  ms: 120000 },
  { label: '5m',  ms: 300000 },
]

function MoistureGauge({ percent }) {
  const clamped = Math.max(0, Math.min(100, percent ?? 0))
  const color = clamped < 30 ? '#e05c3a' : clamped < 60 ? '#e0b03a' : '#1a7f4b'
  return (
    <div style={styles.gaugeWrap}>
      <div style={styles.gaugeTrack}>
        <div style={{ ...styles.gaugeFill, width: `${clamped}%`, background: color }} />
      </div>
      <span style={{ ...styles.gaugePct, color }}>{clamped}%</span>
    </div>
  )
}

function ZoneCard({ zoneId, deviceId, label }) {
  const { sensor, valve } = useZoneData({ zoneId, deviceId })
  const { sitePath } = useSite()
  const [sensorEnabled, setSensorEnabled] = useState(null)

  useEffect(() => {
    if (!deviceId || !zoneId) return
    const unsub = onValue(
      ref(db, sitePath(`devices/${deviceId}/config/sensorEnabled/${zoneId}`)),
      snap => setSensorEnabled(snap.val())
    )
    return unsub
  }, [deviceId, zoneId, sitePath])

  const isOpen      = valve?.state === 'OPEN'
  const lastChanged = valve?.lastChangedAt
    ? new Date(valve.lastChangedAt).toLocaleTimeString()
    : '—'

  if (sensorEnabled === false) {
    return (
      <div style={{ ...styles.card, opacity: 0.6 }}>
        <div style={styles.cardHeader}>
          <span style={styles.zoneName}>{label}</span>
        </div>
        <p style={styles.disabledNote}>Sensor disabled — enable in device config above</p>
      </div>
    )
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <span style={styles.zoneName}>{label}</span>
        <span style={{ ...styles.valveBadge, background: isOpen ? '#e05c3a' : '#1a7f4b' }}>
          {isOpen ? 'OPEN' : 'CLOSED'}
        </span>
      </div>
      <MoistureGauge percent={sensor?.moisturePercent} />
      <div style={styles.meta}>
        <span>Moisture: {sensor?.moisturePercent ?? '—'}%</span>
        <span>Valve last changed: {lastChanged}</span>
        {valve?.openedBy && <span>Opened by: {valve.openedBy}</span>}
      </div>
    </div>
  )
}

function DeviceConfig({ deviceId }) {
  const { sitePath, zones, renameZone } = useSite()
  const { isGuest } = useAuth()
  const device = useDeviceData(deviceId)
  const [open,           setOpen]           = useState(false)
  const [configMs,       setConfigMs]       = useState(null)
  const [sensorEnabled,  setSensorEnabled]  = useState({})
  const [saving,         setSaving]         = useState(false)
  const [renamingZone,   setRenamingZone]   = useState(null)   // zoneId being renamed
  const [editName,       setEditName]       = useState('')

  const deviceZones = zones.filter(z => z.deviceId === deviceId)

  function startRename(z) {
    setEditName(z.label)
    setRenamingZone(z.id)
  }

  async function handleRename(e, zoneId) {
    e.preventDefault()
    if (!editName.trim()) return
    await renameZone(zoneId, deviceId, editName.trim())
    setRenamingZone(null)
  }

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

  const reportedIntervalMs = device?.sensorIntervalMs ?? null

  async function applyInterval(ms) {
    setSaving(true)
    await set(ref(db, sitePath(`devices/${deviceId}/config/sensorIntervalMs`)), ms)
    setSaving(false)
  }

  async function toggleSensor(zoneId, enabled) {
    await set(ref(db, sitePath(`devices/${deviceId}/config/sensorEnabled/${zoneId}`)), enabled)
  }

  function fmt(ms) {
    if (!ms) return null
    return ms < 60000 ? `${ms / 1000}s` : `${ms / 60000}m`
  }

  // Summary shown in the collapsed header
  const intervalSummary = configMs ? `interval ${fmt(configMs)}` : null
  const disabledZones   = deviceZones.filter(z => sensorEnabled[z.id] === false)
  const disabledSummary = disabledZones.length > 0
    ? `${disabledZones.map(z => z.label).join(', ')} sensor off`
    : null
  const summary = [intervalSummary, disabledSummary].filter(Boolean).join(' · ')

  return (
    <div style={styles.configCard}>
      {/* Collapsible header */}
      <button style={styles.configToggle} onClick={() => setOpen(o => !o)}>
        <span style={styles.configToggleLabel}>Device config</span>
        {!open && summary && <span style={styles.configSummary}>{summary}</span>}
        <span style={styles.configChevron}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <>
          {/* Sensor interval row */}
          <div style={styles.configRow}>
            <span style={styles.configLabel}>Sensor interval</span>
            <div style={styles.configRight}>
              {configMs && (
                <span style={styles.configStatus}>
                  set {fmt(configMs)}
                  {reportedIntervalMs && reportedIntervalMs !== configMs &&
                    <span style={{ color: '#e0b03a' }}> · device reports {fmt(reportedIntervalMs)}</span>
                  }
                </span>
              )}
              {!isGuest && (
                <div style={styles.presetRow}>
                  {INTERVAL_PRESETS.map(p => (
                    <button
                      key={p.ms}
                      disabled={saving}
                      style={{ ...styles.presetBtn, ...(configMs === p.ms ? styles.presetActive : {}) }}
                      onClick={() => applyInterval(p.ms)}
                    >{p.label}</button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Per-zone rows: name + sensor toggle */}
          {deviceZones.map(z => {
            const enabled   = sensorEnabled[z.id] ?? null
            const isRenaming = renamingZone === z.id
            return (
              <div key={z.id} style={styles.zoneConfigBlock}>
                {/* Zone name row */}
                <div style={styles.configRow}>
                  <span style={styles.configLabel}>Zone name</span>
                  <div style={styles.configRight}>
                    {isRenaming ? (
                      <form onSubmit={e => handleRename(e, z.id)} style={styles.inlineForm}>
                        <input
                          autoFocus
                          style={styles.inlineInput}
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => e.key === 'Escape' && setRenamingZone(null)}
                        />
                        <button style={styles.inlineSave} type="submit">✓</button>
                        <button style={styles.inlineCancel} type="button" onClick={() => setRenamingZone(null)}>✕</button>
                      </form>
                    ) : (
                      <>
                        <span style={styles.configStatus}>{z.label}</span>
                        {!isGuest && (
                          <button style={{ ...styles.presetBtn, marginLeft: 'auto' }} onClick={() => startRename(z)}>✎ Rename</button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {/* Sensor enabled row */}
                <div style={styles.configRow}>
                  <span style={styles.configLabel}>Sensor</span>
                  <div style={styles.configRight}>
                    {enabled === null
                      ? <span style={styles.configStatus}>not set</span>
                      : <span style={{ ...styles.configStatus, color: enabled ? '#1a7f4b' : '#e05c3a' }}>
                          {enabled ? 'enabled' : 'disabled'}
                        </span>
                    }
                    {!isGuest && (
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
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

function DeviceStatus({ deviceId }) {
  const device = useDeviceData(deviceId)
  const { renameDevice } = useSite()
  const { isGuest } = useAuth()
  const [renaming, setRenaming] = useState(false)
  const [editName, setEditName] = useState('')

  if (!device) return null

  const displayName = device.name || deviceId
  const lastSeen = device.lastSeen
    ? new Date(device.lastSeen).toLocaleString()
    : '—'
  const age    = device.lastSeen ? Math.floor((Date.now() - device.lastSeen) / 1000) : null
  const online = age !== null && age < 90

  const diag = device.lastDiagnostic
  const diagText = diag
    ? `Last disconnect: ${diag.reason?.replace('_', ' ')} — offline ${diag.offlineSec}s — RSSI ${diag.wifiRssi} dBm — heap ${diag.freeHeap} — ${diag.timestamp ? new Date(diag.timestamp).toLocaleString() : ''}`
    : null

  function fmtInterval(ms) {
    if (!ms) return null
    if (ms < 60000) return `${ms / 1000}s`
    return `${ms / 60000}m`
  }
  const sensorInterval = fmtInterval(device.sensorIntervalMs)
  const maxValve       = fmtInterval(device.maxValveMs)

  function startRename() {
    setEditName(displayName)
    setRenaming(true)
  }

  async function handleRename(e) {
    e.preventDefault()
    if (!editName.trim()) return
    await renameDevice(deviceId, editName.trim())
    setRenaming(false)
  }

  return (
    <div style={styles.deviceBar}>
      <span style={{ ...styles.dot, background: online ? '#1a7f4b' : '#e05c3a' }} />
      {renaming ? (
        <form onSubmit={handleRename} style={{ ...styles.inlineForm, flex: 1 }}>
          <input
            autoFocus
            style={styles.inlineInput}
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && setRenaming(false)}
          />
          <button style={styles.inlineSave} type="submit">✓</button>
          <button style={styles.inlineCancel} type="button" onClick={() => setRenaming(false)}>✕</button>
        </form>
      ) : (
        <>
          <span style={styles.deviceText}>
            <strong style={{ color: online ? '#1a7f4b' : '#e05c3a' }}>{displayName}</strong>
            {' '}{online ? 'online' : 'offline'}
            {device.firmware    && ` — fw v${device.firmware}`}
            {sensorInterval     && ` — sensor every ${sensorInterval}`}
            {maxValve           && ` — valve max ${maxValve}`}
            {device.ipAddress   && ` — ${device.ipAddress}`}
            {device.wifiRssi    && ` — RSSI ${device.wifiRssi} dBm`}
            {` — last seen ${lastSeen}`}
            {diagText && <><br /><span style={{ color: '#e0b03a' }}>{diagText}</span></>}
          </span>
          {!isGuest && <button style={styles.iconBtn} onClick={startRename} title="Rename device">✎</button>}
        </>
      )}
    </div>
  )
}

export default function Dashboard() {
  const { zones, devices } = useSite()

  // Group zones by deviceId — zones with no deviceId fall under 'unassigned'
  const zonesByDevice = zones.reduce((acc, z) => {
    const key = z.deviceId || 'unassigned'
    if (!acc[key]) acc[key] = []
    acc[key].push(z)
    return acc
  }, {})

  // Devices that have zones registered
  const activeDevices = devices.filter(d => zonesByDevice[d.id])
  // Zones not linked to any known device
  const unassigned = zonesByDevice['unassigned'] || []

  return (
    <div style={styles.page}>
      {devices.length === 0 && zones.length === 0 && (
        <p style={styles.empty}>No devices or zones configured for this site.</p>
      )}
      {activeDevices.map(d => (
        <div key={d.id} style={styles.deviceGroup}>
          <DeviceStatus deviceId={d.id} />
          <DeviceConfig deviceId={d.id} />
          {zonesByDevice[d.id].map(z => (
            <ZoneCard key={z.id} zoneId={z.id} deviceId={z.deviceId} label={z.label} />
          ))}
        </div>
      ))}
      {unassigned.map(z => (
        <ZoneCard key={z.id} zoneId={z.id} deviceId={z.deviceId} label={z.label} />
      ))}
    </div>
  )
}

const styles = {
  page:         { display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1rem' },
  deviceGroup:  { display: 'flex', flexDirection: 'column', gap: '0.75rem', background: '#0f1f15', borderRadius: '14px', padding: '0.75rem' },
  card:         { background: '#1e2d24', borderRadius: '12px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  cardHeader:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' },
  disabledNote: { color: '#3a5a45', fontSize: '0.82rem', margin: 0 },
  nameRow:      { display: 'flex', alignItems: 'center', gap: '0.4rem' },
  zoneName:     { color: '#e0f0e8', fontSize: '1.1rem', fontWeight: 600 },
  valveBadge:   { color: '#fff', fontSize: '0.75rem', fontWeight: 700, padding: '0.25rem 0.6rem', borderRadius: '6px', flexShrink: 0 },
  gaugeWrap:    { display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' },
  gaugeTrack:   { flex: 1, height: '12px', background: '#2e4a38', borderRadius: '6px', overflow: 'hidden' },
  gaugeFill:    { height: '100%', borderRadius: '5px', transition: 'width 0.5s ease' },
  gaugePct:     { fontSize: '0.9rem', fontWeight: 700, minWidth: '36px', textAlign: 'right' },
  meta:         { display: 'flex', flexDirection: 'column', gap: '0.3rem', color: '#7aab90', fontSize: '0.82rem' },
  deviceBar:    { display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#1e2d24', borderRadius: '8px', padding: '0.75rem 1rem' },
  dot:          { width: '9px', height: '9px', borderRadius: '50%', flexShrink: 0 },
  deviceText:   { color: '#7aab90', fontSize: '0.8rem', flex: 1 },
  iconBtn:      { background: 'transparent', border: '1px solid #3a5a45', borderRadius: '6px', color: '#7aab90', fontSize: '0.85rem', padding: '0.4rem 0.6rem', cursor: 'pointer', flexShrink: 0, lineHeight: 1 },
  inlineForm:   { display: 'flex', alignItems: 'center', gap: '0.4rem', flex: 1 },
  inlineInput:  { background: '#0f1f15', border: '1px solid #3a5a45', borderRadius: '6px', color: '#e0f0e8', fontSize: '0.95rem', padding: '0.4rem 0.6rem', flex: 1, outline: 'none' },
  inlineSave:   { background: '#1a7f4b', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '0.85rem', padding: '0.4rem 0.6rem', cursor: 'pointer' },
  inlineCancel: { background: 'transparent', border: '1px solid #3a5a45', borderRadius: '6px', color: '#7aab90', fontSize: '0.85rem', padding: '0.4rem 0.6rem', cursor: 'pointer' },
  empty:        { color: '#3a5a45', fontSize: '0.9rem', textAlign: 'center', marginTop: '2rem' },

  // DeviceConfig
  configCard:        { background: '#1e2d24', borderRadius: '8px', padding: '0.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  configToggle:      { display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.25rem 0', width: '100%', textAlign: 'left' },
  configToggleLabel: { color: '#7aab90', fontSize: '0.78rem', fontWeight: 600 },
  configSummary:     { color: '#3a5a45', fontSize: '0.75rem', flex: 1 },
  configChevron:     { color: '#3a5a45', fontSize: '0.65rem', marginLeft: 'auto' },
  zoneConfigBlock: { display: 'flex', flexDirection: 'column', gap: '0', borderTop: '1px solid #2e4a38', paddingTop: '0.4rem' },
  configRow:    { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', minHeight: '2rem', paddingTop: '0.4rem' },
  configLabel:  { color: '#7aab90', fontSize: '0.78rem', flexShrink: 0, minWidth: '100px' },
  configRight:  { display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, flexWrap: 'wrap' },
  configStatus: { color: '#a0c8b0', fontSize: '0.78rem' },
  presetRow:    { display: 'flex', gap: '0.3rem', marginLeft: 'auto' },
  presetBtn:    { padding: '0.3rem 0.65rem', borderRadius: '6px', border: '1px solid #3a5a45', background: 'transparent', color: '#7aab90', fontSize: '0.78rem', cursor: 'pointer' },
  presetActive: { background: '#1a7f4b', color: '#fff', borderColor: '#1a7f4b' },
  presetDanger: { background: '#e05c3a', color: '#fff', borderColor: '#e05c3a' },
}
