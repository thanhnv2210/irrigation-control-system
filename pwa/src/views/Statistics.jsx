import { useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer
} from 'recharts'
import { useHistory } from '../hooks/useHistory'

const ZONES   = [{ id: 'balcony', label: 'Balcony' }, { id: 'garden', label: 'Garden' }]
const RANGES  = [
  { label: '4h',  points: 24  },
  { label: '8h',  points: 48  },
  { label: '24h', points: 144 },
]

function formatTime(ts) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function formatDate(ts) {
  const d = new Date(ts)
  return `${d.getMonth()+1}/${d.getDate()} ${formatTime(ts)}`
}

function StatCard({ label, value, unit, color }) {
  return (
    <div style={styles.statCard}>
      <span style={styles.statLabel}>{label}</span>
      <span style={{ ...styles.statValue, color }}>{value}<span style={styles.statUnit}>{unit}</span></span>
    </div>
  )
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={styles.tooltip}>
      <p style={styles.tooltipTime}>{label}</p>
      <p style={styles.tooltipVal}>{payload[0].value}%</p>
    </div>
  )
}

function ZoneChart({ zoneId, label, points }) {
  const { history, loading } = useHistory(zoneId, points)

  const data = history.map(h => ({
    time:    formatTime(h.timestamp),
    fullTs:  formatDate(h.timestamp),
    moisture: h.moisturePercent
  }))

  const values   = history.map(h => h.moisturePercent)
  const avg      = values.length ? Math.round(values.reduce((a,b) => a+b, 0) / values.length) : null
  const min      = values.length ? Math.min(...values) : null
  const max      = values.length ? Math.max(...values) : null
  const current  = values.length ? values[values.length - 1] : null
  const trend    = values.length >= 2 ? values[values.length-1] - values[values.length-2] : 0

  const currentColor = current === null ? '#7aab90'
    : current < 30 ? '#e05c3a'
    : current < 60 ? '#e0b03a'
    : '#1a7f4b'

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <span style={styles.zoneName}>{label}</span>
        {trend !== 0 && (
          <span style={{ color: trend > 0 ? '#1a7f4b' : '#e05c3a', fontSize: '0.8rem' }}>
            {trend > 0 ? '▲' : '▼'} {Math.abs(trend)}%
          </span>
        )}
      </div>

      {loading ? (
        <div style={styles.empty}>Loading...</div>
      ) : history.length === 0 ? (
        <div style={styles.empty}>No history yet — data appears after first device reading</div>
      ) : (
        <>
          <div style={styles.statsRow}>
            <StatCard label="Current" value={current ?? '—'} unit="%" color={currentColor} />
            <StatCard label="Avg"     value={avg ?? '—'}     unit="%" color="#7aab90" />
            <StatCard label="Min"     value={min ?? '—'}     unit="%" color="#e05c3a" />
            <StatCard label="Max"     value={max ?? '—'}     unit="%" color="#1a7f4b" />
          </div>

          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2e4a38" />
              <XAxis
                dataKey="time"
                tick={{ fill: '#7aab90', fontSize: 10 }}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: '#7aab90', fontSize: 10 }}
                tickFormatter={v => `${v}%`}
              />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={30} stroke="#e05c3a" strokeDasharray="4 2" label={{ value: 'Dry', fill: '#e05c3a', fontSize: 10 }} />
              <ReferenceLine y={60} stroke="#1a7f4b" strokeDasharray="4 2" label={{ value: 'Healthy', fill: '#1a7f4b', fontSize: 10 }} />
              <Line
                type="monotone"
                dataKey="moisture"
                stroke="#1a7f4b"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#1a7f4b' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  )
}

export default function Statistics() {
  const [range, setRange] = useState(RANGES[1])  // default 8h

  return (
    <div style={styles.page}>
      <div style={styles.rangeRow}>
        {RANGES.map(r => (
          <button
            key={r.label}
            style={{ ...styles.rangeBtn, ...(range.label === r.label ? styles.rangeActive : {}) }}
            onClick={() => setRange(r)}
          >
            {r.label}
          </button>
        ))}
      </div>
      {ZONES.map(z => (
        <ZoneChart key={z.id} zoneId={z.id} label={z.label} points={range.points} />
      ))}
    </div>
  )
}

const styles = {
  page:       { display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' },
  rangeRow:   { display: 'flex', gap: '0.5rem' },
  rangeBtn:   { padding: '0.4rem 1rem', borderRadius: '8px', border: '1px solid #3a5a45', background: 'transparent', color: '#7aab90', fontSize: '0.85rem', cursor: 'pointer' },
  rangeActive:{ background: '#1a7f4b', color: '#fff', borderColor: '#1a7f4b' },
  card:       { background: '#1e2d24', borderRadius: '12px', padding: '1.25rem' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' },
  zoneName:   { color: '#e0f0e8', fontSize: '1.1rem', fontWeight: 600 },
  statsRow:   { display: 'flex', gap: '0.5rem', marginBottom: '1rem' },
  statCard:   { flex: 1, background: '#162a1e', borderRadius: '8px', padding: '0.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem' },
  statLabel:  { color: '#7aab90', fontSize: '0.7rem' },
  statValue:  { fontSize: '1.1rem', fontWeight: 700 },
  statUnit:   { fontSize: '0.7rem', fontWeight: 400 },
  empty:      { color: '#7aab90', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' },
  tooltip:    { background: '#1e2d24', border: '1px solid #3a5a45', borderRadius: '8px', padding: '0.5rem 0.75rem' },
  tooltipTime:{ color: '#7aab90', fontSize: '0.75rem', margin: 0 },
  tooltipVal: { color: '#e0f0e8', fontWeight: 700, fontSize: '1rem', margin: 0 }
}
