import { useEffect, useRef, useState, createElement } from 'react'
import { ref, onValue, get, set } from 'firebase/database'
import { db } from '../firebase'
import { useZoneData, useDeviceData } from './useZoneData'
import { useSite } from '../context/SiteContext'

const COOLDOWN_MS = 60 * 60 * 1000

export async function sendTelegram(token, chatId, text) {
  if (!token || !chatId) return false
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    })
    return (await res.json()).ok === true
  } catch { return false }
}

// Cooldown stored in Firebase so all open tabs/environments share the same state.
// Path: irrigation/sites/{siteId}/alertCooldowns/{key}
async function getLastAlert(path) {
  try {
    const snap = await get(ref(db, path))
    return snap.val() ?? 0
  } catch { return 0 }
}

async function setLastAlert(path) {
  try { await set(ref(db, path), Date.now()) } catch {}
}

async function clearLastAlert(path) {
  try { await set(ref(db, path), null) } catch {}
}

function ZoneAlertMonitor({ zone, settings, siteId, alertBasePath }) {
  const { sensor } = useZoneData({ zoneId: zone.id, deviceId: zone.deviceId })
  const moisture = sensor?.moisturePercent
  const prevAbove = useRef(true)

  useEffect(() => {
    prevAbove.current = true
  }, [siteId])

  useEffect(() => {
    async function check() {
      const cfg = settings
      if (!cfg?.telegram?.token || !cfg?.telegram?.chatId || moisture == null) return
      const zoneCfg   = cfg.zones?.[zone.id] ?? {}
      const enabled   = zoneCfg.enabled !== false
      const threshold = zoneCfg.threshold ?? 30
      const isLow     = moisture < threshold
      const wasAbove  = prevAbove.current
      if (enabled && isLow && wasAbove) {
        const alertPath = `${alertBasePath}/zone_${zone.id}`
        const lastSent  = await getLastAlert(alertPath)
        if (Date.now() - lastSent > COOLDOWN_MS) {
          sendTelegram(cfg.telegram.token, cfg.telegram.chatId,
            `⚠️ <b>Low Moisture Alert</b>\n\nZone: <b>${zone.label}</b>\nMoisture: <b>${moisture}%</b> (threshold: ${threshold}%)\nTime: ${new Date().toLocaleString()}\n\n💧 Consider checking the irrigation schedule.`)
          setLastAlert(alertPath)
        }
      }
      prevAbove.current = !isLow
    }
    check()
  }, [moisture, settings, siteId, zone.id, zone.label, alertBasePath])

  return null
}

export function useAlertMonitor() {
  const { sitePath, siteId, zones, devices } = useSite()
  const [settings, setSettings] = useState(null)
  const device      = useDeviceData(devices[0]?.id ?? 'esp32-01')
  const deviceName  = device?.name || devices[0]?.id || 'esp32-01'

  const settingsRef      = useRef(null)
  const lastSeenRef      = useRef(null)
  const diagRef          = useRef(null)
  const deviceWasOnline  = useRef(null)
  const offlineStreakRef = useRef(0)

  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => { lastSeenRef.current = device?.lastSeen }, [device?.lastSeen])
  useEffect(() => { diagRef.current = device?.lastDiagnostic }, [device?.lastDiagnostic])

  useEffect(() => {
    const unsub = onValue(ref(db, sitePath('settings/alerts')), snap => {
      setSettings(snap.val() ?? null)
    })
    return unsub
  }, [sitePath])

  // Reset state when switching sites
  useEffect(() => {
    deviceWasOnline.current = null
    offlineStreakRef.current = 0
  }, [siteId])

  useEffect(() => {
    const alertBasePath = sitePath('alertCooldowns')

    async function checkDevice() {
      const cfg      = settingsRef.current
      const lastSeen = lastSeenRef.current
      if (!cfg?.telegram?.token || !cfg?.telegram?.chatId || !lastSeen) return
      if (!cfg.offlineEnabled) return
      const thresholdMs = (cfg.offlineMinutes ?? 5) * 60 * 1000
      const isOnline    = Date.now() - lastSeen < thresholdMs
      const wasOnline   = deviceWasOnline.current

      if (wasOnline === null) {
        deviceWasOnline.current = isOnline
        offlineStreakRef.current = isOnline ? 0 : 1
        return
      }

      if (!isOnline) {
        offlineStreakRef.current++
      } else {
        offlineStreakRef.current = 0
      }

      // Only alert offline after 2 consecutive misses (reduces SSL blip false alarms)
      if (!isOnline && wasOnline && offlineStreakRef.current >= 2) {
        const alertPath = `${alertBasePath}/device_offline`
        const lastSent  = await getLastAlert(alertPath)
        if (Date.now() - lastSent > COOLDOWN_MS) {
          const mins = Math.round((Date.now() - lastSeen) / 60000)
          sendTelegram(cfg.telegram.token, cfg.telegram.chatId,
            `🔴 <b>Device Offline</b>\n\n<b>${deviceName}</b> has not reported in <b>${mins} min</b>.\nTime: ${new Date().toLocaleString()}\n\nCheck WiFi connection or power supply.`)
          setLastAlert(alertPath)
        }
      } else if (isOnline && wasOnline === false) {
        const onlinePath  = `${alertBasePath}/device_online`
        const offlinePath = `${alertBasePath}/device_offline`
        const lastSent    = await getLastAlert(onlinePath)
        if (Date.now() - lastSent > COOLDOWN_MS) {
          const diag = diagRef.current
          const diagLine = diag
            ? `\n\n📋 <b>Disconnect reason:</b> ${diag.reason?.replace('_', ' ')}\n⏱ Offline: ${diag.offlineSec}s\n📶 RSSI: ${diag.wifiRssi} dBm\n🧠 Free heap: ${diag.freeHeap} bytes`
            : ''
          sendTelegram(cfg.telegram.token, cfg.telegram.chatId,
            `🟢 <b>Device Back Online</b>\n\n<b>${deviceName}</b> reconnected successfully.\nTime: ${new Date().toLocaleString()}${diagLine}`)
          setLastAlert(onlinePath)
        }
        clearLastAlert(offlinePath)
      }
      deviceWasOnline.current = isOnline
    }
    checkDevice()
    const timer = setInterval(checkDevice, 60 * 1000)
    return () => clearInterval(timer)
  }, [siteId])

  const alertBasePath = sitePath('alertCooldowns')
  return zones.map(zone =>
    createElement(ZoneAlertMonitor, { key: zone.id, zone, settings, siteId, alertBasePath })
  )
}
