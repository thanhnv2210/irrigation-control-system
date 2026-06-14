import { useState, useEffect } from 'react'
import { ref, onValue, set } from 'firebase/database'
import { db } from '../firebase'
import { useDeviceData } from '../hooks/useZoneData'
import { useSite } from '../context/SiteContext'

function getLastAlert(zoneId) {
  const v = localStorage.getItem(`irrigAlert_${zoneId}`)
  return v ? new Date(parseInt(v)).toLocaleString() : '—'
}

async function sendTelegram(token, chatId, text) {
  if (!token || !chatId) return false
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    })
    const data = await res.json()
    return data.ok === true
  } catch {
    return false
  }
}

export default function Alerts() {
  const [settings,       setSettings]       = useState(null)
  const [token,          setToken]          = useState('')
  const [chatId,         setChatId]         = useState('')
  const [thresholds,     setThresholds]     = useState({})
  const [enabled,        setEnabled]        = useState({})
  const [offlineMinutes, setOfflineMinutes] = useState(5)
  const [offlineEnabled, setOfflineEnabled] = useState(false)
  const [saving,         setSaving]         = useState(false)
  const [testStatus,     setTestStatus]     = useState('')

  const { sitePath, zones, devices } = useSite()
  const device = useDeviceData(devices[0]?.id ?? 'esp32-01')
  const offlineThresholdMs = offlineMinutes * 60 * 1000
  const isOnline  = device?.lastSeen && Date.now() - device.lastSeen < offlineThresholdMs
  const lastSeenStr = device?.lastSeen
    ? new Date(device.lastSeen).toLocaleTimeString()
    : '—'

  useEffect(() => {
    const unsub = onValue(ref(db, sitePath('settings/alerts')), snap => {
      const val = snap.val()
      if (!val) return
      setSettings(val)
      setToken(val.telegram?.token ?? '')
      setChatId(val.telegram?.chatId ?? '')
      setOfflineMinutes(val.offlineMinutes ?? 5)
      setOfflineEnabled(val.offlineEnabled ?? false)
      const th = {}, en = {}
      for (const z of zones) {
        th[z.id] = val.zones?.[z.id]?.threshold ?? 30
        en[z.id] = val.zones?.[z.id]?.enabled   !== false
      }
      setThresholds(th)
      setEnabled(en)
    })
    return unsub
  }, [sitePath, zones])

  async function save() {
    setSaving(true)
    const data = {
      telegram: { token: token.trim(), chatId: chatId.trim() },
      offlineMinutes: Number(offlineMinutes),
      offlineEnabled,
      zones: {}
    }
    for (const z of zones) {
      data.zones[z.id] = { threshold: Number(thresholds[z.id]), enabled: enabled[z.id] }
    }
    await set(ref(db, sitePath('settings/alerts')), data)
    setSaving(false)
  }

  async function sendTest() {
    setTestStatus('')
    const ok = await sendTelegram(
      token.trim(), chatId.trim(),
      '✅ <b>Irrigation Alert Test</b>\nYour alert is configured correctly.'
    )
    setTestStatus(ok ? 'ok' : 'fail')
    setTimeout(() => setTestStatus(''), 4000)
  }

  return (
    <div style={styles.page}>

      {/* Telegram setup */}
      <div style={styles.card}>
        <span style={styles.cardTitle}>Telegram Alerts</span>
        <p style={styles.hint}>
          Create a bot via <strong style={{ color: '#e0f0e8' }}>@BotFather</strong>, then message{' '}
          <strong style={{ color: '#e0f0e8' }}>@userinfobot</strong> to get your Chat ID.
        </p>

        <label style={styles.lbl}>Bot Token</label>
        <input
          style={styles.input}
          type="text"
          placeholder="123456:ABC-DEF..."
          value={token}
          onChange={e => setToken(e.target.value)}
        />

        <label style={styles.lbl}>Chat ID</label>
        <input
          style={styles.input}
          type="text"
          placeholder="123456789"
          value={chatId}
          onChange={e => setChatId(e.target.value)}
        />

        <div style={styles.btnRow}>
          <button style={{ ...styles.btn, background: '#1a7f4b' }} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            style={{ ...styles.btn, background: testStatus === 'ok' ? '#1a7f4b' : testStatus === 'fail' ? '#e05c3a' : '#2a3d5a' }}
            onClick={sendTest}
            disabled={!token || !chatId}
          >
            {testStatus === 'ok' ? 'Sent ✓' : testStatus === 'fail' ? 'Failed ✗' : 'Test'}
          </button>
        </div>
      </div>

      {/* Device offline */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <span style={styles.cardTitle}>Device Offline Alert</span>
          <label style={styles.toggle}>
            <input
              type="checkbox"
              checked={offlineEnabled}
              onChange={e => setOfflineEnabled(e.target.checked)}
              style={{ accentColor: '#1a7f4b' }}
            />
            <span style={{ color: offlineEnabled ? '#1a7f4b' : '#3a5a45', fontSize: '0.8rem', marginLeft: '0.4rem' }}>
              {offlineEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </label>
        </div>
        {offlineEnabled && (
          <span style={{ ...styles.badge, background: device ? (isOnline ? '#1a7f4b' : '#e05c3a') : '#3a5a45', alignSelf: 'flex-start' }}>
            {device ? (isOnline ? 'ONLINE' : 'OFFLINE') : 'NO DATA'} · last seen {lastSeenStr}
          </span>
        )}
        <p style={styles.hint}>
          Sends a 🔴 alert if the device stops reporting. Sends a 🟢 recovery message when it reconnects.
          {!offlineEnabled && <strong style={{ color: '#e0b03a' }}> Disabled — enable when hardware is connected.</strong>}
        </p>

        <div style={{ ...styles.thresholdRow, opacity: offlineEnabled ? 1 : 0.4, pointerEvents: offlineEnabled ? 'auto' : 'none' }}>
          <span style={styles.lbl}>Alert after</span>
          <input
            type="range"
            min={2} max={30} step={1}
            value={offlineMinutes}
            onChange={e => setOfflineMinutes(e.target.value)}
            style={{ flex: 1, accentColor: '#1a7f4b' }}
          />
          <span style={styles.thresholdVal}>{offlineMinutes} min</span>
        </div>

        <button style={{ ...styles.btn, background: '#1a7f4b' }} onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Thresholds */}
      <div style={styles.card}>
        <span style={styles.cardTitle}>Alert Thresholds</span>
        <p style={styles.hint}>Send an alert when moisture drops below the threshold. Cooldown: 1 hour per zone.</p>

        {zones.map(z => (
          <div key={z.id} style={styles.zoneRow}>
            <div style={styles.zoneHeader}>
              <span style={styles.zoneName}>{z.label}</span>
              <label style={styles.toggle}>
                <input
                  type="checkbox"
                  checked={enabled[z.id]}
                  onChange={e => setEnabled(prev => ({ ...prev, [z.id]: e.target.checked }))}
                  style={{ accentColor: '#1a7f4b' }}
                />
                <span style={{ color: enabled[z.id] ? '#1a7f4b' : '#3a5a45', fontSize: '0.8rem', marginLeft: '0.4rem' }}>
                  {enabled[z.id] ? 'Enabled' : 'Disabled'}
                </span>
              </label>
            </div>

            <div style={styles.thresholdRow}>
              <input
                type="range"
                min={10} max={60} step={5}
                value={thresholds[z.id]}
                disabled={!enabled[z.id]}
                onChange={e => setThresholds(prev => ({ ...prev, [z.id]: e.target.value }))}
                style={{ flex: 1, accentColor: '#1a7f4b' }}
              />
              <span style={styles.thresholdVal}>{thresholds[z.id]}%</span>
            </div>

            <div style={styles.lastAlertRow}>
              <span style={styles.hint}>Last alert: {getLastAlert(z.id)}</span>
            </div>
          </div>
        ))}

        <button style={{ ...styles.btn, background: '#1a7f4b' }} onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Thresholds'}
        </button>
      </div>

      {/* How it works */}
      <div style={styles.card}>
        <span style={styles.cardTitle}>How it works</span>
        <div style={styles.steps}>
          {[
            '1. The app monitors live moisture while open in your browser.',
            '2. When moisture crosses below the threshold, a Telegram message is sent.',
            '3. Alerts are rate-limited to once per hour per zone to avoid spam.',
            '4. The alert resets when moisture rises above the threshold again.',
          ].map((s, i) => <p key={i} style={styles.hint}>{s}</p>)}
        </div>
      </div>

    </div>
  )
}

const styles = {
  page:         { display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' },
  card:         { background: '#1e2d24', borderRadius: '12px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  cardHeader:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle:    { color: '#e0f0e8', fontSize: '1rem', fontWeight: 600 },
  badge:        { color: '#fff', fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '5px' },
  hint:         { color: '#7aab90', fontSize: '0.8rem', margin: 0, lineHeight: 1.5 },
  lbl:          { color: '#a0c8b0', fontSize: '0.8rem' },
  input:        { background: '#0f1f15', border: '1px solid #3a5a45', borderRadius: '8px', padding: '0.6rem 0.75rem', color: '#e0f0e8', fontSize: '0.9rem', outline: 'none' },
  btnRow:       { display: 'flex', gap: '0.75rem' },
  btn:          { flex: 1, padding: '0.8rem', borderRadius: '8px', border: 'none', color: '#fff', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer' },
  zoneRow:      { borderTop: '1px solid #2e4a38', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  zoneHeader:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  zoneName:     { color: '#e0f0e8', fontWeight: 600, fontSize: '0.9rem' },
  toggle:       { display: 'flex', alignItems: 'center', cursor: 'pointer' },
  thresholdRow: { display: 'flex', alignItems: 'center', gap: '0.75rem' },
  thresholdVal: { color: '#e0f0e8', fontWeight: 700, fontSize: '1rem', minWidth: '3rem', textAlign: 'right' },
  lastAlertRow: {},
  steps:        { display: 'flex', flexDirection: 'column', gap: '0.4rem' },
}
