import { useState } from 'react'
import { useZoneData, useDeviceData } from '../hooks/useZoneData'
import { useSite } from '../context/SiteContext'
import { useAuth } from '../App'

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
  const { renameZone } = useSite()
  const { isGuest } = useAuth()
  const [renaming,  setRenaming]  = useState(false)
  const [editName,  setEditName]  = useState('')

  const isOpen = valve?.state === 'OPEN'
  const lastChanged = valve?.lastChangedAt
    ? new Date(valve.lastChangedAt).toLocaleTimeString()
    : '—'

  function startRename() {
    setEditName(label)
    setRenaming(true)
  }

  async function handleRename(e) {
    e.preventDefault()
    if (!editName.trim()) return
    await renameZone(zoneId, deviceId, editName.trim())
    setRenaming(false)
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        {renaming ? (
          <form onSubmit={handleRename} style={styles.inlineForm}>
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
          <div style={styles.nameRow}>
            <span style={styles.zoneName}>{label}</span>
            {!isGuest && <button style={styles.iconBtn} onClick={startRename} title="Rename zone">✎</button>}
          </div>
        )}
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
  card:         { background: '#1e2d24', borderRadius: '12px', padding: '1.25rem' },
  cardHeader:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.5rem' },
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
  empty:        { color: '#3a5a45', fontSize: '0.9rem', textAlign: 'center', marginTop: '2rem' }
}
