import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import { useZoneData, useDeviceData } from '../hooks/useZoneData'
import { useSite } from '../context/SiteContext'

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
        <p style={styles.disabledNote}>Sensor disabled — enable in Settings → Device config</p>
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

function DeviceStatus({ deviceId }) {
  const device = useDeviceData(deviceId)

  if (!device) return null

  const displayName = device.name || deviceId
  const lastSeen    = device.lastSeen ? new Date(device.lastSeen).toLocaleString() : '—'
  const age         = device.lastSeen ? Math.floor((Date.now() - device.lastSeen) / 1000) : null
  const online      = age !== null && age < 90

  const diag = device.lastDiagnostic
  const diagText = diag
    ? `Last disconnect: ${diag.reason?.replace('_', ' ')} — offline ${diag.offlineSec}s — RSSI ${diag.wifiRssi} dBm — heap ${diag.freeHeap} — ${diag.timestamp ? new Date(diag.timestamp).toLocaleString() : ''}`
    : null

  function fmtMs(ms) {
    if (!ms) return null
    return ms < 60000 ? `${ms / 1000}s` : `${ms / 60000}m`
  }

  return (
    <div style={styles.deviceBar}>
      <span style={{ ...styles.dot, background: online ? '#1a7f4b' : '#e05c3a' }} />
      <span style={styles.deviceText}>
        <strong style={{ color: online ? '#1a7f4b' : '#e05c3a' }}>{displayName}</strong>
        {' '}{online ? 'online' : 'offline'}
        {device.firmware  && ` — fw v${device.firmware}`}
        {fmtMs(device.sensorIntervalMs) && ` — sensor every ${fmtMs(device.sensorIntervalMs)}`}
        {fmtMs(device.maxValveMs)       && ` — valve max ${fmtMs(device.maxValveMs)}`}
        {device.ipAddress && ` — ${device.ipAddress}`}
        {device.wifiRssi  && ` — RSSI ${device.wifiRssi} dBm`}
        {` — last seen ${lastSeen}`}
        {diagText && <><br /><span style={{ color: '#e0b03a' }}>{diagText}</span></>}
      </span>
    </div>
  )
}

export default function Dashboard() {
  const { zones, devices } = useSite()

  const zonesByDevice = zones.reduce((acc, z) => {
    const key = z.deviceId || 'unassigned'
    if (!acc[key]) acc[key] = []
    acc[key].push(z)
    return acc
  }, {})

  const activeDevices = devices.filter(d => zonesByDevice[d.id])
  const unassigned    = zonesByDevice['unassigned'] || []

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
  card:         { background: '#1e2d24', borderRadius: '12px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  cardHeader:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' },
  disabledNote: { color: '#3a5a45', fontSize: '0.82rem', margin: 0 },
  zoneName:     { color: '#e0f0e8', fontSize: '1.1rem', fontWeight: 600 },
  valveBadge:   { color: '#fff', fontSize: '0.75rem', fontWeight: 700, padding: '0.25rem 0.6rem', borderRadius: '6px', flexShrink: 0 },
  gaugeWrap:    { display: 'flex', alignItems: 'center', gap: '0.75rem' },
  gaugeTrack:   { flex: 1, height: '12px', background: '#2e4a38', borderRadius: '6px', overflow: 'hidden' },
  gaugeFill:    { height: '100%', borderRadius: '5px', transition: 'width 0.5s ease' },
  gaugePct:     { fontSize: '0.9rem', fontWeight: 700, minWidth: '36px', textAlign: 'right' },
  meta:         { display: 'flex', flexDirection: 'column', gap: '0.3rem', color: '#7aab90', fontSize: '0.82rem' },
  deviceBar:    { display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#1e2d24', borderRadius: '8px', padding: '0.75rem 1rem' },
  dot:          { width: '9px', height: '9px', borderRadius: '50%', flexShrink: 0 },
  deviceText:   { color: '#7aab90', fontSize: '0.8rem', flex: 1 },
  empty:        { color: '#3a5a45', fontSize: '0.9rem', textAlign: 'center', marginTop: '2rem' },
}
