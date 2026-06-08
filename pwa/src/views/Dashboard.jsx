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

function ZoneCard({ zoneId, label }) {
  const { sensor, valve } = useZoneData(zoneId)
  const isOpen = valve?.state === 'OPEN'
  const lastChanged = valve?.lastChangedAt
    ? new Date(valve.lastChangedAt).toLocaleTimeString()
    : '—'

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

  const lastSeen = device.lastSeen
    ? new Date(device.lastSeen).toLocaleString()
    : '—'
  const age = device.lastSeen
    ? Math.floor((Date.now() - device.lastSeen) / 1000)
    : null
  const online = age !== null && age < 90  // online if seen within 90s

  return (
    <div style={styles.deviceBar}>
      <span style={{ ...styles.dot, background: online ? '#1a7f4b' : '#e05c3a' }} />
      <span style={styles.deviceText}>
        Device {online ? 'online' : 'offline'} — {device.ipAddress} — RSSI {device.wifiRssi} dBm — last seen {lastSeen}
      </span>
    </div>
  )
}

export default function Dashboard() {
  const { zones } = useSite()
  return (
    <div style={styles.page}>
      <DeviceStatus deviceId="esp32-01" />
      {zones.length === 0 && (
        <p style={styles.empty}>No zones configured for this site.</p>
      )}
      {zones.map(z => (
        <ZoneCard key={z.id} zoneId={z.id} label={z.label} />
      ))}
    </div>
  )
}

const styles = {
  page:       { display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' },
  card:       { background: '#1e2d24', borderRadius: '12px', padding: '1.25rem' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' },
  zoneName:   { color: '#e0f0e8', fontSize: '1.1rem', fontWeight: 600 },
  valveBadge: { color: '#fff', fontSize: '0.75rem', fontWeight: 700, padding: '0.25rem 0.6rem', borderRadius: '6px' },
  gaugeWrap:  { display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' },
  gaugeTrack: { flex: 1, height: '10px', background: '#2e4a38', borderRadius: '5px', overflow: 'hidden' },
  gaugeFill:  { height: '100%', borderRadius: '5px', transition: 'width 0.5s ease' },
  gaugePct:   { fontSize: '0.9rem', fontWeight: 700, minWidth: '36px', textAlign: 'right' },
  meta:       { display: 'flex', flexDirection: 'column', gap: '0.25rem', color: '#7aab90', fontSize: '0.8rem' },
  deviceBar:  { display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#1e2d24', borderRadius: '8px', padding: '0.6rem 1rem' },
  dot:        { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  deviceText: { color: '#7aab90', fontSize: '0.78rem' },
  empty:      { color: '#3a5a45', fontSize: '0.9rem', textAlign: 'center', marginTop: '2rem' }
}
