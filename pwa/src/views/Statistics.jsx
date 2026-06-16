import { useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ReferenceArea, ResponsiveContainer
} from 'recharts'
import { useHistory, useHistoryByDate } from '../hooks/useHistory'
import { useSite } from '../context/SiteContext'
const RANGES  = [
  { label: '4h',  windowMs: 4  * 60 * 60 * 1000 },
  { label: '8h',  windowMs: 8  * 60 * 60 * 1000 },
  { label: '24h', windowMs: 24 * 60 * 60 * 1000 },
]

const SMOOTHING = [
  { label: 'Off', window: 1  },
  { label: '5pt', window: 5  },
  { label: '10pt',window: 10 },
  { label: '20pt',window: 20 },
]

function applyMovingAverage(data, windowSize) {
  if (windowSize <= 1) return data
  const half = Math.floor(windowSize / 2)
  return data.map((d, i) => {
    const start = Math.max(0, i - half)
    const end   = Math.min(data.length, i + half + 1)
    const slice = data.slice(start, end)
    const avg   = slice.reduce((sum, p) => sum + p.moisture, 0) / slice.length
    return { ...d, moisture: Math.round(avg * 10) / 10 }
  })
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function formatTime(ts) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function StatCard({ label, value, unit, color }) {
  return (
    <div style={styles.statCard}>
      <span style={styles.statLabel}>{label}</span>
      <span style={{ ...styles.statValue, color }}>{value}<span style={styles.statUnit}>{unit}</span></span>
    </div>
  )
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={styles.tooltip}>
      <p style={styles.tooltipTime}>{d.fullTime}</p>
      <p style={styles.tooltipVal}>{d.moisture}%</p>
      {d.valveOpen && <p style={styles.tooltipWater}>Irrigating</p>}
    </div>
  )
}

// Build watering bands from entries that have valveOpen:true
function buildWateringBands(history, data) {
  const bands = []
  for (let i = 0; i < history.length; i++) {
    if (history[i].valveOpen) {
      const x1 = data[i]?.time
      // Band extends to the next tick for visibility
      const x2 = data[i + 1]?.time ?? x1
      if (x1) bands.push({ x1, x2, label: x1 })
    }
  }
  return bands
}

function ZoneChart({ zoneId, deviceId, label, mode, range, dateStr, smoothingWindow }) {
  const recent = useHistory({ zoneId, deviceId }, range.windowMs)
  const byDate = useHistoryByDate({ zoneId, deviceId }, mode === 'date' ? dateStr : null)

  const { history, loading } = mode === 'date' ? byDate : recent

  const rawData = history.map(h => ({
    time:     formatTime(h.timestamp),
    fullTime: new Date(h.timestamp).toLocaleTimeString(),
    moisture: h.moisturePercent,
    valveOpen: !!h.valveOpen
  }))
  const data = applyMovingAverage(rawData, smoothingWindow)

  const values  = history.map(h => h.moisturePercent)
  const avg     = values.length ? Math.round(values.reduce((a,b) => a+b, 0) / values.length) : null
  const min     = values.length ? Math.min(...values) : null
  const max     = values.length ? Math.max(...values) : null
  const current = values.length ? values[values.length - 1] : null
  const trend   = values.length >= 2 ? values[values.length-1] - values[values.length-2] : 0

  const currentColor = current === null ? '#7aab90'
    : current < 30 ? '#e05c3a'
    : current < 60 ? '#e0b03a'
    : '#1a7f4b'

  const waterBands  = buildWateringBands(history, data)
  const tickInterval = mode === 'date' ? Math.max(1, Math.floor(data.length / 12)) : 'preserveStartEnd'

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <span style={styles.zoneName}>{label}</span>
        {trend !== 0 && (
          <span style={{ color: trend > 0 ? '#1a7f4b' : '#e05c3a', fontSize: '0.8rem' }}>
            {trend > 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>

      {loading ? (
        <div style={styles.empty}>Loading...</div>
      ) : history.length === 0 ? (
        <div style={styles.empty}>
          {mode === 'date'
            ? 'No data for this date — use Sim → Seed Historical Day to generate demo data.'
            : 'No history yet — data appears after first device reading'}
        </div>
      ) : (
        <>
          <div style={styles.statsRow}>
            <StatCard label="Current" value={current ?? '—'} unit="%" color={currentColor} />
            <StatCard label="Avg"     value={avg ?? '—'}     unit="%" color="#7aab90" />
            <StatCard label="Min"     value={min ?? '—'}     unit="%" color="#e05c3a" />
            <StatCard label="Max"     value={max ?? '—'}     unit="%" color="#1a7f4b" />
          </div>

          {waterBands.length > 0 && (
            <div style={styles.legendRow}>
              <span style={styles.legendBand} />
              <span style={styles.legendText}>
                Irrigation: {waterBands.length} event{waterBands.length !== 1 ? 's' : ''} at{' '}
                {waterBands.map(b => b.label).join(', ')}
              </span>
            </div>
          )}

          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              {/* Green shaded bands where valve was open */}
              {waterBands.map((b, i) => (
                <ReferenceArea
                  key={i}
                  x1={b.x1} x2={b.x2}
                  fill="#1a7f4b" fillOpacity={0.25}
                  stroke="#1a7f4b" strokeOpacity={0.6}
                />
              ))}

              <CartesianGrid strokeDasharray="3 3" stroke="#2e4a38" />
              <XAxis
                dataKey="time"
                tick={{ fill: '#7aab90', fontSize: 10 }}
                interval={tickInterval}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: '#7aab90', fontSize: 10 }}
                tickFormatter={v => `${v}%`}
              />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={30} stroke="#e05c3a" strokeDasharray="4 2"
                label={{ value: 'Dry', fill: '#e05c3a', fontSize: 10 }} />
              <ReferenceLine y={60} stroke="#1a7f4b" strokeDasharray="4 2"
                label={{ value: 'Healthy', fill: '#1a7f4b', fontSize: 10 }} />
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

          <p style={styles.hint}>
            {rawData.length} readings
            {smoothingWindow > 1 ? ` · ${smoothingWindow}-point moving avg` : ''}
            {waterBands.length > 0 ? ' · green bands = irrigation active' : ''}
          </p>
        </>
      )}
    </div>
  )
}

export default function Statistics() {
  const { zones } = useSite()
  const [mode,      setMode]      = useState('recent')      // 'recent' | 'date'
  const [range,     setRange]     = useState(RANGES[1])     // default 8h
  const [dateStr,   setDateStr]   = useState(todayStr)
  const [smoothing, setSmoothing] = useState(SMOOTHING[0])  // default Off

  return (
    <div style={styles.page}>
      {/* Mode toggle */}
      <div style={styles.modeRow}>
        <button
          style={{ ...styles.modeBtn, ...(mode === 'recent' ? styles.modeActive : {}) }}
          onClick={() => setMode('recent')}
        >Recent</button>
        <button
          style={{ ...styles.modeBtn, ...(mode === 'date' ? styles.modeActive : {}) }}
          onClick={() => setMode('date')}
        >By Date</button>
      </div>

      {/* Time range / date controls */}
      {mode === 'recent' ? (
        <div style={styles.rangeRow}>
          {RANGES.map(r => (
            <button
              key={r.label}
              style={{ ...styles.rangeBtn, ...(range.label === r.label ? styles.rangeActive : {}) }}
              onClick={() => setRange(r)}
            >{r.label}</button>
          ))}
        </div>
      ) : (
        <div style={styles.dateRow}>
          <input
            type="date"
            value={dateStr}
            max={todayStr()}
            onChange={e => setDateStr(e.target.value)}
            style={styles.dateInput}
          />
        </div>
      )}

      {/* Smoothing controls */}
      <div style={styles.smoothRow}>
        <span style={styles.smoothLabel}>Smooth</span>
        {SMOOTHING.map(s => (
          <button
            key={s.label}
            style={{ ...styles.rangeBtn, ...(smoothing.label === s.label ? styles.rangeActive : {}) }}
            onClick={() => setSmoothing(s)}
          >{s.label}</button>
        ))}
      </div>

      {zones.length === 0 && (
        <p style={{ color: '#3a5a45', fontSize: '0.9rem', textAlign: 'center', marginTop: '2rem' }}>
          No zones configured for this site.
        </p>
      )}
      {zones.map(z => (
        <ZoneChart
          key={z.id}
          zoneId={z.id}
          deviceId={z.deviceId}
          label={z.label}
          mode={mode}
          range={range}
          dateStr={dateStr}
          smoothingWindow={smoothing.window}
        />
      ))}
    </div>
  )
}

const styles = {
  page:        { display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' },
  modeRow:     { display: 'flex', gap: '0.5rem' },
  modeBtn:     { flex: 1, padding: '0.65rem', borderRadius: '8px', border: '1px solid #3a5a45', background: 'transparent', color: '#7aab90', fontSize: '0.9rem', cursor: 'pointer' },
  modeActive:  { background: '#2e4a38', color: '#e0f0e8', borderColor: '#1a7f4b', fontWeight: 600 },
  rangeRow:    { display: 'flex', gap: '0.5rem' },
  smoothRow:   { display: 'flex', gap: '0.5rem', alignItems: 'center' },
  smoothLabel: { color: '#7aab90', fontSize: '0.82rem', marginRight: '0.25rem', whiteSpace: 'nowrap' },
  rangeBtn:    { padding: '0.6rem 1rem', borderRadius: '8px', border: '1px solid #3a5a45', background: 'transparent', color: '#7aab90', fontSize: '0.9rem', cursor: 'pointer' },
  rangeActive: { background: '#1a7f4b', color: '#fff', borderColor: '#1a7f4b' },
  dateRow:     { display: 'flex' },
  dateInput:   { flex: 1, background: '#1e2d24', border: '1px solid #3a5a45', borderRadius: '8px', padding: '0.65rem 0.75rem', color: '#e0f0e8', fontSize: '0.95rem', outline: 'none', colorScheme: 'dark' },
  card:        { background: '#1e2d24', borderRadius: '12px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  cardHeader:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  zoneName:    { color: '#e0f0e8', fontSize: '1.1rem', fontWeight: 600 },
  statsRow:    { display: 'flex', gap: '0.5rem' },
  statCard:    { flex: 1, background: '#162a1e', borderRadius: '8px', padding: '0.6rem 0.4rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' },
  statLabel:   { color: '#7aab90', fontSize: '0.75rem' },
  statValue:   { fontSize: '1.1rem', fontWeight: 700 },
  statUnit:    { fontSize: '0.72rem', fontWeight: 400 },
  legendRow:   { display: 'flex', alignItems: 'center', gap: '0.4rem' },
  legendBand:  { width: '12px', height: '12px', borderRadius: '3px', background: '#1a7f4b', opacity: 0.6, flexShrink: 0 },
  legendText:  { color: '#7aab90', fontSize: '0.75rem' },
  empty:       { color: '#7aab90', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' },
  hint:        { color: '#3a5a45', fontSize: '0.78rem', margin: 0 },
  tooltip:     { background: '#1e2d24', border: '1px solid #3a5a45', borderRadius: '8px', padding: '0.5rem 0.75rem' },
  tooltipTime: { color: '#7aab90', fontSize: '0.75rem', margin: 0 },
  tooltipVal:  { color: '#e0f0e8', fontWeight: 700, fontSize: '1rem', margin: 0 },
  tooltipWater:{ color: '#1a7f4b', fontSize: '0.75rem', margin: 0 },
}
