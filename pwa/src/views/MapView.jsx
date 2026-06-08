import { useState, useEffect, useRef } from 'react'
import { ref, onValue, set } from 'firebase/database'
import { db } from '../firebase'
import { useZoneData } from '../hooks/useZoneData'

// Garden dimensions (metres) — change to match your actual space
const GARDEN_W = 10
const GARDEN_H = 20

const ZONES = [
  { id: 'balcony', label: 'Balcony' },
  { id: 'garden',  label: 'Garden'  },
]

// Colours ─────────────────────────────────────────────────────────────────
function moistureColor(pct) {
  if (pct == null) return '#7aab90'
  if (pct < 30)   return '#e05c3a'
  if (pct < 60)   return '#e0b03a'
  return '#1a7f4b'
}

// Convert percentage position → SVG pixel coords and back
function pctToSvg(px, py, svgW, svgH) {
  return [px / 100 * svgW, py / 100 * svgH]
}
function svgToPct(sx, sy, svgW, svgH) {
  return [
    Math.max(0, Math.min(100, sx / svgW * 100)),
    Math.max(0, Math.min(100, sy / svgH * 100)),
  ]
}

// ── Zone pin (SVG group) ──────────────────────────────────────────────────
function ZonePin({ zone, svgW, svgH, onDragStart }) {
  const { sensor, valve } = useZoneData(zone.id)
  const [meta, setMeta]   = useState(null)

  useEffect(() => {
    return onValue(ref(db, `irrigation/zones/${zone.id}/meta`), snap => setMeta(snap.val()))
  }, [zone.id])

  const pct       = sensor?.moisturePercent ?? null
  const valveOpen = valve?.state === 'OPEN'
  const color     = moistureColor(pct)
  const label     = pct != null ? `${Math.round(pct)}%` : '?'

  if (!meta?.px || !meta?.py) return null

  const [x, y] = pctToSvg(meta.px, meta.py, svgW, svgH)

  return (
    <g
      style={{ cursor: 'grab' }}
      onPointerDown={e => { e.preventDefault(); onDragStart(e, zone.id, meta) }}
    >
      {/* Valve-open pulse ring */}
      {valveOpen && (
        <circle cx={x} cy={y} r={22} fill="none" stroke="#3a8fd4" strokeWidth={2} opacity={0.5} />
      )}
      {/* Pin circle */}
      <circle cx={x} cy={y} r={16} fill={color} stroke="#1e2d24" strokeWidth={2} />
      {/* Moisture label */}
      <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle"
        fontSize={10} fontWeight="700" fill="#fff" style={{ pointerEvents: 'none', userSelect: 'none' }}>
        {label}
      </text>
      {/* Zone name below */}
      <text x={x} y={y + 26} textAnchor="middle"
        fontSize={9} fill="#a0c8b0" style={{ pointerEvents: 'none', userSelect: 'none' }}>
        {meta?.name || zone.label}
      </text>
    </g>
  )
}

// ── Grid lines (every 1 m) ────────────────────────────────────────────────
function GridLines({ svgW, svgH }) {
  const lines = []
  for (let m = 1; m < GARDEN_W; m++) {
    const x = m / GARDEN_W * svgW
    lines.push(<line key={`v${m}`} x1={x} y1={0} x2={x} y2={svgH} stroke="#2e4a38" strokeWidth={0.5} />)
  }
  for (let m = 1; m < GARDEN_H; m++) {
    const y = m / GARDEN_H * svgH
    lines.push(<line key={`h${m}`} x1={0} y1={y} x2={svgW} y2={y} stroke="#2e4a38" strokeWidth={0.5} />)
  }
  // Axis labels (every 5 m)
  for (let m = 0; m <= GARDEN_W; m += 5) {
    const x = m / GARDEN_W * svgW
    lines.push(
      <text key={`lx${m}`} x={x} y={svgH + 12} textAnchor="middle"
        fontSize={9} fill="#3a5a45">{m}m</text>
    )
  }
  for (let m = 0; m <= GARDEN_H; m += 5) {
    const y = m / GARDEN_H * svgH
    lines.push(
      <text key={`ly${m}`} x={-8} y={y} textAnchor="end" dominantBaseline="middle"
        fontSize={9} fill="#3a5a45">{m}m</text>
    )
  }
  return <>{lines}</>
}

// ── Main view ─────────────────────────────────────────────────────────────
export default function MapView() {
  const svgRef   = useRef(null)
  const [placing, setPlacing] = useState(null)   // zone id to place
  const [metas,   setMetas]   = useState({})
  const [dragging, setDragging] = useState(null) // { zoneId, meta }
  const [tooltip, setTooltip] = useState(null)   // { zoneId, x, y }

  // SVG viewBox — 10:20 aspect. Display width fills container.
  const PAD   = 20   // padding for axis labels
  const SVG_W = 200  // internal units (10 m → 200 units = 1m per 20px)
  const SVG_H = 400  // internal units (20 m → 400 units)

  useEffect(() => {
    const unsubs = ZONES.map(z =>
      onValue(ref(db, `irrigation/zones/${z.id}/meta`), snap =>
        setMetas(prev => ({ ...prev, [z.id]: snap.val() }))
      )
    )
    return () => unsubs.forEach(u => u())
  }, [])

  // ── Place mode — click on SVG ─────────────────────────────────────────
  function handleSvgClick(e) {
    if (!placing) return
    const rect = svgRef.current.getBoundingClientRect()
    const scaleX = (SVG_W) / (rect.width  - PAD)
    const scaleY = (SVG_H) / (rect.height - PAD)
    const sx = (e.clientX - rect.left - PAD) * scaleX
    const sy = (e.clientY - rect.top)        * scaleY
    const [px, py] = svgToPct(sx, sy, SVG_W, SVG_H)
    savePos(placing, px, py)
    setPlacing(null)
  }

  // ── Drag ─────────────────────────────────────────────────────────────
  function handleDragStart(e, zoneId, meta) {
    if (placing) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging({ zoneId, meta })
  }

  function handlePointerMove(e) {
    if (!dragging) return
    const rect = svgRef.current.getBoundingClientRect()
    const scaleX = SVG_W / (rect.width  - PAD)
    const scaleY = SVG_H / (rect.height - PAD)
    const sx = (e.clientX - rect.left - PAD) * scaleX
    const sy = (e.clientY - rect.top)        * scaleY
    const [px, py] = svgToPct(sx, sy, SVG_W, SVG_H)
    setMetas(prev => ({
      ...prev,
      [dragging.zoneId]: { ...prev[dragging.zoneId], px, py }
    }))
  }

  function handlePointerUp() {
    if (!dragging) return
    const m = metas[dragging.zoneId]
    if (m?.px != null) savePos(dragging.zoneId, m.px, m.py)
    setDragging(null)
  }

  async function savePos(zoneId, px, py) {
    const zone     = ZONES.find(z => z.id === zoneId)
    const existing = metas[zoneId] ?? {}
    await set(ref(db, `irrigation/zones/${zoneId}/meta`), {
      name:    existing.name    || zone.label,
      enabled: existing.enabled !== false,
      ...existing,
      px, py
    })
  }

  return (
    <div style={styles.page}>
      <p style={styles.hint}>
        Tap <strong style={{ color: '#e0f0e8' }}>+ Pin</strong> then tap the garden to place a zone.
        Drag pins to reposition. Grid: 1 m per cell.
      </p>

      {/* Pin buttons */}
      <div style={styles.btnRow}>
        {ZONES.map(z => {
          const hasPin = metas[z.id]?.px != null
          const active = placing === z.id
          return (
            <button
              key={z.id}
              style={{ ...styles.pinBtn, background: active ? '#3a8fd4' : hasPin ? '#2e4a38' : '#1a7f4b' }}
              onClick={() => setPlacing(active ? null : z.id)}
            >
              {active ? `Tap garden…` : hasPin ? `Move ${z.label}` : `+ Pin ${z.label}`}
            </button>
          )
        })}
      </div>

      {/* Garden SVG */}
      <div style={styles.svgWrap}>
        <svg
          ref={svgRef}
          viewBox={`-${PAD} -4 ${SVG_W + PAD + 4} ${SVG_H + PAD + 4}`}
          style={{ width: '100%', height: '100%', cursor: placing ? 'crosshair' : 'default', touchAction: 'none' }}
          onClick={handleSvgClick}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* Garden border */}
          <rect x={0} y={0} width={SVG_W} height={SVG_H}
            fill="#162a1e" stroke="#3a5a45" strokeWidth={1.5} rx={2} />

          <GridLines svgW={SVG_W} svgH={SVG_H} />

          {/* Zone pins */}
          {ZONES.map(z => (
            <ZonePin
              key={z.id}
              zone={z}
              svgW={SVG_W}
              svgH={SVG_H}
              onDragStart={handleDragStart}
            />
          ))}

          {/* Compass */}
          <text x={SVG_W - 4} y={14} textAnchor="end" fontSize={11} fill="#3a5a45">N↑</text>
        </svg>
      </div>

      {/* Legend */}
      <div style={styles.legend}>
        {[
          { color: '#1a7f4b', label: '≥60% healthy' },
          { color: '#e0b03a', label: '30–60% low' },
          { color: '#e05c3a', label: '<30% dry' },
          { color: '#3a8fd4', label: 'valve open' },
        ].map(l => (
          <div key={l.label} style={styles.legendItem}>
            <span style={{ ...styles.dot, background: l.color }} />
            <span style={styles.legendText}>{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const styles = {
  page:       { display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem' },
  hint:       { color: '#7aab90', fontSize: '0.8rem', margin: 0 },
  btnRow:     { display: 'flex', gap: '0.5rem' },
  pinBtn:     { flex: 1, padding: '0.5rem', borderRadius: '8px', border: 'none', color: '#fff', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' },
  svgWrap:    { width: '100%', aspectRatio: `${GARDEN_W} / ${GARDEN_H}`, maxHeight: '60vh', background: '#0f1f15', borderRadius: '12px', border: '1px solid #2e4a38', overflow: 'hidden' },
  legend:     { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' },
  legendItem: { display: 'flex', alignItems: 'center', gap: '0.35rem' },
  dot:        { width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0 },
  legendText: { color: '#7aab90', fontSize: '0.75rem' },
}
