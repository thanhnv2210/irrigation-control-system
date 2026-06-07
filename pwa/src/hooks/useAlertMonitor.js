import { useEffect, useRef, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import { useZoneData } from './useZoneData'
import { useDeviceData } from './useZoneData'

const COOLDOWN_MS = 60 * 60 * 1000  // 1 hour between moisture alerts per zone

export async function sendTelegram(token, chatId, text) {
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

function getLastAlert(key) {
  return parseInt(localStorage.getItem(`irrigAlert_${key}`) || '0')
}
function setLastAlert(key) {
  localStorage.setItem(`irrigAlert_${key}`, Date.now().toString())
}
function clearLastAlert(key) {
  localStorage.removeItem(`irrigAlert_${key}`)
}

// Runs as a background hook in App — monitors zones + device, fires Telegram alerts
export function useAlertMonitor() {
  const [settings, setSettings] = useState(null)
  const balcony = useZoneData('balcony')
  const garden  = useZoneData('garden')
  const device  = useDeviceData('esp32-01')

  // Refs so interval callbacks always read the latest values without re-registering
  const settingsRef      = useRef(null)
  const lastSeenRef      = useRef(null)
  const deviceWasOnline  = useRef(null)   // null = not yet determined
  const prevAbove        = useRef({ balcony: true, garden: true })

  // Keep refs in sync
  useEffect(() => { settingsRef.current = settings },      [settings])
  useEffect(() => { lastSeenRef.current = device?.lastSeen }, [device?.lastSeen])

  // Watch alert settings from Firebase
  useEffect(() => {
    const unsub = onValue(ref(db, 'irrigation/settings/alerts'), snap => {
      setSettings(snap.val() ?? null)
    })
    return unsub
  }, [])

  // ── Moisture alerts ───────────────────────────────────────────────────────
  const balconyMoisture = balcony.sensor?.moisturePercent
  const gardenMoisture  = garden.sensor?.moisturePercent

  useEffect(() => {
    const cfg = settings
    if (!cfg?.telegram?.token || !cfg?.telegram?.chatId) return

    const checks = [
      { id: 'balcony', label: 'Balcony', moisture: balconyMoisture },
      { id: 'garden',  label: 'Garden',  moisture: gardenMoisture  },
    ]

    for (const { id, label, moisture } of checks) {
      if (moisture == null) continue

      const zoneCfg   = cfg.zones?.[id] ?? {}
      const enabled   = zoneCfg.enabled !== false
      const threshold = zoneCfg.threshold ?? 30
      const isLow     = moisture < threshold
      const wasAbove  = prevAbove.current[id]

      if (enabled && isLow && wasAbove) {
        if (Date.now() - getLastAlert(id) > COOLDOWN_MS) {
          const msg =
            `⚠️ <b>Low Moisture Alert</b>\n\n` +
            `Zone: <b>${label}</b>\n` +
            `Moisture: <b>${moisture}%</b> (threshold: ${threshold}%)\n` +
            `Time: ${new Date().toLocaleString()}\n\n` +
            `💧 Consider checking the irrigation schedule.`
          sendTelegram(cfg.telegram.token, cfg.telegram.chatId, msg)
          setLastAlert(id)
        }
      }

      prevAbove.current[id] = !isLow
    }
  }, [balconyMoisture, gardenMoisture, settings])

  // ── Device offline alerts — checked every 60 s via interval ──────────────
  useEffect(() => {
    function checkDevice() {
      const cfg      = settingsRef.current
      const lastSeen = lastSeenRef.current
      if (!cfg?.telegram?.token || !cfg?.telegram?.chatId || !lastSeen) return
      if (!cfg.offlineEnabled) return

      const thresholdMs = (cfg.offlineMinutes ?? 5) * 60 * 1000
      const isOnline    = Date.now() - lastSeen < thresholdMs
      const wasOnline   = deviceWasOnline.current

      if (wasOnline === null) {
        // First check — just record state, no alert
        deviceWasOnline.current = isOnline
        return
      }

      if (!isOnline && wasOnline) {
        // Just went offline
        if (Date.now() - getLastAlert('device') > COOLDOWN_MS) {
          const mins = Math.round((Date.now() - lastSeen) / 60000)
          const msg =
            `🔴 <b>Device Offline</b>\n\n` +
            `<b>esp32-01</b> has not reported in <b>${mins} min</b>.\n` +
            `Time: ${new Date().toLocaleString()}\n\n` +
            `Check WiFi connection or power supply.`
          sendTelegram(cfg.telegram.token, cfg.telegram.chatId, msg)
          setLastAlert('device')
        }
      } else if (isOnline && wasOnline === false) {
        // Came back online — always notify (no cooldown)
        const msg =
          `🟢 <b>Device Back Online</b>\n\n` +
          `<b>esp32-01</b> reconnected successfully.\n` +
          `Time: ${new Date().toLocaleString()}`
        sendTelegram(cfg.telegram.token, cfg.telegram.chatId, msg)
        clearLastAlert('device')
      }

      deviceWasOnline.current = isOnline
    }

    checkDevice()  // run immediately on mount
    const timer = setInterval(checkDevice, 60 * 1000)
    return () => clearInterval(timer)
  }, [])  // runs once — reads live values via refs
}
