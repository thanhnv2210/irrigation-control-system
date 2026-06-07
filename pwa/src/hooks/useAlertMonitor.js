import { useEffect, useRef, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import { useZoneData } from './useZoneData'

const COOLDOWN_MS = 60 * 60 * 1000  // 1 hour between alerts per zone

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

function getLastAlert(zoneId) {
  return parseInt(localStorage.getItem(`irrigAlert_${zoneId}`) || '0')
}
function setLastAlert(zoneId) {
  localStorage.setItem(`irrigAlert_${zoneId}`, Date.now().toString())
}

// Runs as a background hook in App — monitors both zones and fires Telegram alerts
export function useAlertMonitor() {
  const [settings, setSettings] = useState(null)
  const balcony = useZoneData('balcony')
  const garden  = useZoneData('garden')

  // Track whether each zone was above threshold last tick (avoid alerting on open)
  const prevAbove = useRef({ balcony: true, garden: true })

  useEffect(() => {
    const unsub = onValue(ref(db, 'irrigation/settings/alerts'), snap => {
      setSettings(snap.val() ?? null)
    })
    return unsub
  }, [])

  const balconyMoisture = balcony.sensor?.moisturePercent
  const gardenMoisture  = garden.sensor?.moisturePercent

  useEffect(() => {
    if (!settings?.telegram?.token || !settings?.telegram?.chatId) return

    const checks = [
      { id: 'balcony', label: 'Balcony', moisture: balconyMoisture },
      { id: 'garden',  label: 'Garden',  moisture: gardenMoisture  },
    ]

    for (const { id, label, moisture } of checks) {
      if (moisture == null) continue

      const zoneCfg   = settings.zones?.[id] ?? {}
      const enabled   = zoneCfg.enabled !== false
      const threshold = zoneCfg.threshold ?? 30

      const isLow    = moisture < threshold
      const wasAbove = prevAbove.current[id]

      if (enabled && isLow && wasAbove) {
        const lastAlert = getLastAlert(id)
        if (Date.now() - lastAlert > COOLDOWN_MS) {
          const msg =
            `⚠️ <b>Low Moisture Alert</b>\n` +
            `Zone: <b>${label}</b>\n` +
            `Moisture: <b>${moisture}%</b> (threshold: ${threshold}%)\n` +
            `Time: ${new Date().toLocaleString()}`
          sendTelegram(settings.telegram.token, settings.telegram.chatId, msg)
          setLastAlert(id)
        }
      }

      prevAbove.current[id] = !isLow
    }
  }, [balconyMoisture, gardenMoisture, settings])
}
