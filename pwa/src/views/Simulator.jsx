import { useState, useEffect, useRef } from 'react'
import { ref, set, push, get, update } from 'firebase/database'
import { db } from '../firebase'
import { useZoneData } from '../hooks/useZoneData'
import { logAudit } from '../utils/audit'
import { useSite } from '../context/SiteContext'

const INTERVALS = [
  { label: '10s',  ms: 10000   },
  { label: '30s',  ms: 30000   },
  { label: '1m',   ms: 60000   },
  { label: '10m',  ms: 600000  },
]

// Simulates a slow moisture decay, with a spike when valve is open
function nextMoisture(current, valveOpen) {
  if (valveOpen) return Math.min(95, current + Math.floor(Math.random() * 8) + 5)
  const decay = Math.random() * 2
  return Math.max(10, Math.round((current - decay) * 10) / 10)
}

// ---------------------------------------------------------------------------
// Device sensor simulator — runs a JS interval to push readings
// ---------------------------------------------------------------------------
function DeviceSimulator() {
  const { sitePath, zones } = useSite()
  const sitePathRef = useRef(sitePath)
  useEffect(() => { sitePathRef.current = sitePath }, [sitePath])

  const [running,   setRunning]  = useState(false)
  const [interval,  setInterval_] = useState(INTERVALS[0])
  const [log,       setLog]      = useState([])
  const [moisture,  setMoisture] = useState({})
  const [valveOpen, setValveOpen] = useState({})
  const timerRef  = useRef(null)
  const stateRef  = useRef({ moisture: {}, valveOpen: {} })
  const zonesRef  = useRef(zones)
  useEffect(() => { zonesRef.current = zones }, [zones])

  // Keep ref in sync so the interval closure always has fresh values
  useEffect(() => {
    stateRef.current = { moisture, valveOpen }
  }, [moisture, valveOpen])

  function addLog(msg) {
    const ts = new Date().toLocaleTimeString()
    setLog(l => [`[${ts}] ${msg}`, ...l].slice(0, 50))
  }

  async function tick() {
    const sp = sitePathRef.current
    const { moisture: m, valveOpen: v } = stateRef.current
    const newMoisture = {}

    for (const zone of zonesRef.current) {
      const pct = nextMoisture(m[zone.id] ?? 62, v[zone.id] ?? false)
      const raw = Math.round(3200 - (pct / 100) * 2000)
      newMoisture[zone.id] = pct

      const sensorData = { moisturePercent: pct, rawValue: raw, timestamp: Date.now() }

      await set(ref(db, sp(`zones/${zone.id}/sensor`)), sensorData)
      await push(ref(db, sp(`zones/${zone.id}/history`)), sensorData)

      const cmdSnap = await get(ref(db, sp(`zones/${zone.id}/command`)))
      const cmd = cmdSnap.val()

      if (cmd?.action === 'OPEN') {
        await set(ref(db, sp(`zones/${zone.id}/valve`)), { state: 'OPEN', openedBy: 'manual', lastChangedAt: Date.now() })
        await set(ref(db, sp(`zones/${zone.id}/command/action`)), null)
        setValveOpen(prev => ({ ...prev, [zone.id]: true }))
        addLog(`${zone.label}: command OPEN → valve opened, command cleared`)
      } else if (cmd?.action === 'CLOSE') {
        await set(ref(db, sp(`zones/${zone.id}/valve`)), { state: 'CLOSED', openedBy: 'manual', lastChangedAt: Date.now() })
        await set(ref(db, sp(`zones/${zone.id}/command/action`)), null)
        setValveOpen(prev => ({ ...prev, [zone.id]: false }))
        addLog(`${zone.label}: command CLOSE → valve closed, command cleared`)
      }

      addLog(`${zone.label}: moisture ${pct}% (raw ${raw})${v[zone.id] ? ' 💧 valve open' : ''}`)
    }

    await set(ref(db, sp('devices/esp32-01')), {
      firmware: '1.0.0-sim',
      ipAddress: '127.0.0.1',
      wifiRssi: -45,
      lastSeen: Date.now()
    })

    setMoisture(newMoisture)
  }

  function start() {
    setRunning(true)
    addLog(`Simulator started — interval ${interval.label}`)
    tick()
    timerRef.current = setInterval(tick, interval.ms)
  }

  function stop() {
    clearInterval(timerRef.current)
    setRunning(false)
    addLog('Simulator stopped')
  }

  useEffect(() => () => clearInterval(timerRef.current), [])

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <span style={styles.cardTitle}>Device Simulator</span>
        <span style={{ ...styles.badge, background: running ? '#1a7f4b' : '#3a5a45' }}>
          {running ? 'RUNNING' : 'STOPPED'}
        </span>
      </div>

      <p style={styles.hint}>
        Simulates the ESP32 — publishes sensor readings, responds to valve commands, and writes heartbeat at the selected interval.
      </p>

      <div style={styles.row}>
        <span style={styles.lbl}>Interval</span>
        <div style={styles.intervalRow}>
          {INTERVALS.map(iv => (
            <button key={iv.label} disabled={running}
              style={{ ...styles.intervalBtn, ...(interval.label === iv.label ? styles.intervalActive : {}) }}
              onClick={() => setInterval_(iv)}
            >{iv.label}</button>
          ))}
        </div>
      </div>

      <div style={styles.btnRow}>
        <button style={{ ...styles.btn, background: '#1a7f4b' }} disabled={running}  onClick={start}>Start</button>
        <button style={{ ...styles.btn, background: '#3a5a45' }} disabled={!running} onClick={stop}>Stop</button>
      </div>

      {log.length > 0 && (
        <div style={styles.log}>
          {log.map((l, i) => <div key={i} style={styles.logLine}>{l}</div>)}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ad-hoc zone actions — simulate device acting on a valve directly
// ---------------------------------------------------------------------------
function AdHocActions() {
  const { sitePath, zones } = useSite()
  const [log, setLog] = useState([])

  function addLog(msg) {
    const ts = new Date().toLocaleTimeString()
    setLog(l => [`[${ts}] ${msg}`, ...l].slice(0, 20))
  }

  async function setValve(zoneId, label, state) {
    await set(ref(db, sitePath(`zones/${zoneId}/valve`)), {
      state, openedBy: 'manual', lastChangedAt: Date.now()
    })
    await set(ref(db, sitePath(`zones/${zoneId}/command/action`)), null)
    addLog(`${label}: valve set to ${state}, command cleared`)
  }

  async function publishSensor(zoneId, label, pct) {
    const raw = Math.round(3200 - (pct / 100) * 2000)
    const data = { moisturePercent: pct, rawValue: raw, timestamp: Date.now() }
    await set(ref(db, sitePath(`zones/${zoneId}/sensor`)), data)
    await push(ref(db, sitePath(`zones/${zoneId}/history`)), data)
    addLog(`${label}: published moisture ${pct}%`)
  }

  return (
    <div style={styles.card}>
      <span style={styles.cardTitle}>Ad-hoc Device Actions</span>
      <p style={styles.hint}>Simulate single device actions without running the full simulator.</p>

      {zones.map(z => (
        <div key={z.id} style={styles.zoneBlock}>
          <span style={styles.zoneName}>{z.label}</span>
          <div style={styles.actionRow}>
            <button style={{ ...styles.smallBtn, background: '#e05c3a' }} onClick={() => setValve(z.id, z.label, 'OPEN')}>Valve OPEN</button>
            <button style={{ ...styles.smallBtn, background: '#2e4a38' }} onClick={() => setValve(z.id, z.label, 'CLOSED')}>Valve CLOSE</button>
            <button style={{ ...styles.smallBtn, background: '#2a3d5a' }} onClick={() => publishSensor(z.id, z.label, 25)}>Dry (25%)</button>
            <button style={{ ...styles.smallBtn, background: '#1a5a3a' }} onClick={() => publishSensor(z.id, z.label, 75)}>Wet (75%)</button>
          </div>
        </div>
      ))}

      {log.length > 0 && (
        <div style={styles.log}>
          {log.map((l, i) => <div key={i} style={styles.logLine}>{l}</div>)}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Schedule trigger — fire a schedule entry immediately
// ---------------------------------------------------------------------------
function ScheduleTrigger() {
  const { zones } = useSite()
  const [log, setLog] = useState([])

  function addLog(msg) {
    const ts = new Date().toLocaleTimeString()
    setLog(l => [`[${ts}] ${msg}`, ...l].slice(0, 20))
  }

  function ZoneTrigger({ zoneId, label }) {
    const { schedule, valve } = useZoneData(zoneId)
    const { sitePath } = useSite()
    const entries = Object.entries(schedule || {})

    async function fire(scheduleId, entry) {
      const durationMs = entry.durationMinutes * 60 * 1000
      await set(ref(db, sitePath(`zones/${zoneId}/valve`)), {
        state: 'OPEN', openedBy: 'schedule', lastChangedAt: Date.now()
      })
      logAudit(sitePath, 'SCHEDULE_FIRED', zoneId, { scheduleId, hour: entry.hour, minute: entry.minute, durationMinutes: entry.durationMinutes })
      addLog(`${label}: schedule fired "${entry.hour}:${String(entry.minute).padStart(2,'0')}" — valve OPEN for ${entry.durationMinutes} min`)

      setTimeout(async () => {
        await set(ref(db, sitePath(`zones/${zoneId}/valve`)), {
          state: 'CLOSED', openedBy: 'schedule', lastChangedAt: Date.now()
        })
        addLog(`${label}: schedule duration elapsed — valve CLOSED`)
      }, Math.min(durationMs, 600000))
    }

    if (entries.length === 0) {
      return (
        <div style={styles.zoneBlock}>
          <span style={styles.zoneName}>{label}</span>
          <p style={styles.hint}>No schedules — add one in the Schedule tab first.</p>
        </div>
      )
    }

    return (
      <div style={styles.zoneBlock}>
        <span style={styles.zoneName}>{label}</span>
        {entries.map(([id, entry]) => (
          <div key={id} style={styles.scheduleRow}>
            <span style={styles.scheduleTime}>
              {String(entry.hour).padStart(2,'0')}:{String(entry.minute).padStart(2,'0')} — {entry.durationMinutes} min
            </span>
            <button
              style={{ ...styles.smallBtn, background: entry.enabled ? '#1a7f4b' : '#3a5a45' }}
              disabled={!entry.enabled || valve?.state === 'OPEN'}
              onClick={() => fire(id, entry)}
            >
              Fire now
            </button>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={styles.card}>
      <span style={styles.cardTitle}>Schedule Trigger</span>
      <p style={styles.hint}>Fire a schedule immediately without waiting for the clock. Valve closes after the configured duration.</p>

      {zones.map(z => <ZoneTrigger key={z.id} zoneId={z.id} label={z.label} />)}

      {log.length > 0 && (
        <div style={styles.log}>
          {log.map((l, i) => <div key={i} style={styles.logLine}>{l}</div>)}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Historical data seeder — generate a full day's consistent demo data
// Schedule: 06:00 and 18:00 watering events (matches default schedules)
// ---------------------------------------------------------------------------
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

// Moisture curve params per zone — slight difference for visual interest
const ZONE_START = { balcony: 60, garden: 57 }
const WATERING_TICKS = new Set([36, 108])  // 06:00 = tick 36, 18:00 = tick 108

function DataSeeder() {
  const { sitePath, zones } = useSite()
  const [seedDate, setSeedDate]   = useState(todayStr)
  const [seeding,  setSeeding]    = useState(false)
  const [log,      setLog]        = useState([])

  function addLog(msg) {
    const ts = new Date().toLocaleTimeString()
    setLog(l => [`[${ts}] ${msg}`, ...l].slice(0, 20))
  }

  async function generateDay() {
    setSeeding(true)
    const [yr, mo, dy] = seedDate.split('-').map(Number)
    const dayStart = new Date(yr, mo - 1, dy, 0, 0, 0, 0).getTime()
    const TICK_MS  = 10 * 60 * 1000

    const updates = {}
    let seqN = 0

    for (const zone of zones) {
      let pct = ZONE_START[zone.id] ?? 60

      for (let tick = 0; tick < 144; tick++) {
        const ts         = dayStart + tick * TICK_MS
        const isWatering = WATERING_TICKS.has(tick)

        if (isWatering) {
          pct = Math.min(95, pct + 28 + Math.random() * 5)
        } else {
          pct = Math.max(10, pct - (0.3 + Math.random() * 0.15))
        }
        pct = Math.round(pct * 10) / 10

        const raw   = Math.round(3200 - (pct / 100) * 2000)
        const key   = `-seed${ts.toString(36)}${(seqN++).toString(36)}`
        const entry = { moisturePercent: pct, rawValue: raw, timestamp: ts, valveOpen: isWatering }

        updates[sitePath(`zones/${zone.id}/history/${key}`)] = entry
      }
    }

    await update(ref(db), updates)
    addLog(`Seeded ${seedDate}: 144 readings × ${zones.length} zones — watering at 06:00 & 18:00`)
    setSeeding(false)
  }

  return (
    <div style={styles.card}>
      <span style={styles.cardTitle}>Seed Historical Day</span>
      <p style={styles.hint}>
        Generates 144 readings (every 10 min) for the selected date with realistic moisture decay
        and two watering events at <strong style={{ color: '#1a7f4b' }}>06:00</strong> and{' '}
        <strong style={{ color: '#1a7f4b' }}>18:00</strong> — consistent with the default schedule.
      </p>

      <div style={styles.row}>
        <input
          type="date"
          value={seedDate}
          max={todayStr()}
          onChange={e => setSeedDate(e.target.value)}
          style={styles.dateInput}
          disabled={seeding}
        />
        <button
          style={{ ...styles.btn, background: seeding ? '#2e4a38' : '#1a7f4b', flex: 'none', padding: '0.5rem 1.25rem' }}
          disabled={seeding}
          onClick={generateDay}
        >
          {seeding ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {log.length > 0 && (
        <div style={styles.log}>
          {log.map((l, i) => <div key={i} style={styles.logLine}>{l}</div>)}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
export default function Simulator() {
  return (
    <div style={styles.page}>
      <p style={styles.pageNote}>
        Simulates ESP32 behavior in the browser. Use while waiting for hardware.
      </p>
      <DeviceSimulator />
      <AdHocActions />
      <ScheduleTrigger />
      <DataSeeder />
    </div>
  )
}

const styles = {
  page:          { display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' },
  pageNote:      { color: '#7aab90', fontSize: '0.82rem', margin: 0 },
  card:          { background: '#1e2d24', borderRadius: '12px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  cardHeader:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle:     { color: '#e0f0e8', fontSize: '1rem', fontWeight: 600 },
  badge:         { color: '#fff', fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '5px' },
  hint:          { color: '#7aab90', fontSize: '0.8rem', margin: 0, lineHeight: 1.5 },
  row:           { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  lbl:           { color: '#a0c8b0', fontSize: '0.85rem' },
  intervalRow:   { display: 'flex', gap: '0.4rem' },
  intervalBtn:   { padding: '0.3rem 0.6rem', borderRadius: '6px', border: '1px solid #3a5a45', background: 'transparent', color: '#7aab90', fontSize: '0.8rem', cursor: 'pointer' },
  intervalActive:{ background: '#1a7f4b', color: '#fff', borderColor: '#1a7f4b' },
  btnRow:        { display: 'flex', gap: '0.75rem' },
  btn:           { flex: 1, padding: '0.7rem', borderRadius: '8px', border: 'none', color: '#fff', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer' },
  log:           { background: '#0f1f15', borderRadius: '8px', padding: '0.75rem', maxHeight: '140px', overflowY: 'auto' },
  logLine:       { color: '#7aab90', fontSize: '0.72rem', fontFamily: 'monospace', lineHeight: 1.8 },
  zoneBlock:     { borderTop: '1px solid #2e4a38', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  zoneName:      { color: '#e0f0e8', fontWeight: 600, fontSize: '0.9rem' },
  actionRow:     { display: 'flex', gap: '0.4rem', flexWrap: 'wrap' },
  smallBtn:      { padding: '0.4rem 0.75rem', borderRadius: '6px', border: 'none', color: '#fff', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' },
  scheduleRow:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  scheduleTime:  { color: '#a0c8b0', fontSize: '0.85rem' },
  dateInput:     { flex: 1, background: '#0f1f15', border: '1px solid #3a5a45', borderRadius: '8px', padding: '0.45rem 0.75rem', color: '#e0f0e8', fontSize: '0.9rem', outline: 'none', colorScheme: 'dark' },
}
