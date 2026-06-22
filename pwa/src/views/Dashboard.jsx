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
  const [open, setOpen] = useState(false)

  if (!device) return null

  const displayName = device.name || deviceId
  const lastSeen    = device.lastSeen ? new Date(device.lastSeen).toLocaleString() : '—'
  const age                = device.lastSeen ? Math.floor((Date.now() - device.lastSeen) / 1000) : null
  const heartbeatMs        = device.heartbeatIntervalMs ?? 60000
  const onlineThresholdSec = Math.ceil((heartbeatMs * 2) / 1000)
  const online             = age !== null && age < onlineThresholdSec

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
      <div style={{ flex: 1, minWidth: 0 }}>
        <button style={styles.deviceBarBtn} onClick={() => setOpen(o => !o)}>
          <span style={{ color: online ? '#1a7f4b' : '#e05c3a', fontWeight: 700 }}>{displayName}</span>
          <span style={{ color: '#7aab90' }}>{' '}{online ? 'online' : 'offline'}</span>
          <span style={styles.deviceLastSeen}>— last seen {lastSeen}</span>
          <span style={styles.deviceChevron}>{open ? '▲' : '▼'}</span>
        </button>
        {open && (
          <div style={styles.deviceDetails}>
            {device.firmware  && <span>Firmware: v{device.firmware}</span>}
            {fmtMs(device.sensorIntervalMs) && <span>Sensor interval: {fmtMs(device.sensorIntervalMs)}</span>}
            {fmtMs(device.maxValveMs)       && <span>Valve max: {fmtMs(device.maxValveMs)}</span>}
            {device.ipAddress && <span>IP: {device.ipAddress}</span>}
            {device.wifiRssi  && <span>RSSI: {device.wifiRssi} dBm</span>}
            {device.freeHeap != null && (
              <span style={{ color: device.freeHeap < 30000 ? '#e05c3a' : '#7aab90' }}>
                Free heap: {Math.round(device.freeHeap / 1024)} KB{device.freeHeap < 30000 ? ' (low — may crash soon)' : ''}
              </span>
            )}
            {diagText && <span style={{ color: '#e0b03a' }}>{diagText}</span>}
          </div>
        )}
      </div>
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
  deviceBar:      { display: 'flex', alignItems: 'flex-start', gap: '0.5rem', background: '#1e2d24', borderRadius: '8px', padding: '0.75rem 1rem' },
  dot:            { width: '9px', height: '9px', borderRadius: '50%', flexShrink: 0, marginTop: '5px' },
  deviceBarBtn:   { display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.82rem', width: '100%', textAlign: 'left', flexWrap: 'wrap' },
  deviceLastSeen: { color: '#5a8a70', fontSize: '0.78rem', flexShrink: 0 },
  deviceChevron:  { color: '#3a5a45', fontSize: '0.7rem', marginLeft: 'auto' },
  deviceDetails:  { display: 'flex', flexDirection: 'column', gap: '0.25rem', color: '#7aab90', fontSize: '0.78rem', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid #2e4a38' },
  empty:        { color: '#3a5a45', fontSize: '0.9rem', textAlign: 'center', marginTop: '2rem' },
}
