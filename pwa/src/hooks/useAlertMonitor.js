import { useEffect, useRef, useState, createElement } from 'react'
import { ref, onValue } from 'firebase/database'
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

function getLastAlert(key) { return parseInt(localStorage.getItem(`irrigAlert_${key}`) || '0') }
function setLastAlert(key) { localStorage.setItem(`irrigAlert_${key}`, Date.now().toString()) }
function clearLastAlert(key) { localStorage.removeItem(`irrigAlert_${key}`) }

function ZoneAlertMonitor({ zone, settings, siteId }) {
  const { sensor } = useZoneData(zone.id)
  const moisture = sensor?.moisturePercent
  const prevAbove = useRef(true)

  useEffect(() => {
    prevAbove.current = true
  }, [siteId])

  useEffect(() => {
    const cfg = settings
    if (!cfg?.telegram?.token || !cfg?.telegram?.chatId || moisture == null) return
    const zoneCfg   = cfg.zones?.[zone.id] ?? {}
    const enabled   = zoneCfg.enabled !== false
    const threshold = zoneCfg.threshold ?? 30
    const isLow     = moisture < threshold
    const wasAbove  = prevAbove.current
    if (enabled && isLow && wasAbove) {
      if (Date.now() - getLastAlert(`${siteId}_${zone.id}`) > COOLDOWN_MS) {
        sendTelegram(cfg.telegram.token, cfg.telegram.chatId,
          `⚠️ <b>Low Moisture Alert</b>\n\nZone: <b>${zone.label}</b>\nMoisture: <b>${moisture}%</b> (threshold: ${threshold}%)\nTime: ${new Date().toLocaleString()}\n\n💧 Consider checking the irrigation schedule.`)
        setLastAlert(`${siteId}_${zone.id}`)
      }
    }
    prevAbove.current = !isLow
  }, [moisture, settings, siteId, zone.id, zone.label])

  return null
}

export function useAlertMonitor() {
  const { sitePath, siteId, zones, devices } = useSite()
  const [settings, setSettings] = useState(null)
  const device  = useDeviceData(devices[0]?.id ?? 'esp32-01')
  const deviceName = device?.name || devices[0]?.id || 'esp32-01'

  const settingsRef     = useRef(null)
  const lastSeenRef     = useRef(null)
  const deviceWasOnline = useRef(null)

  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => { lastSeenRef.current = device?.lastSeen }, [device?.lastSeen])

  useEffect(() => {
    const unsub = onValue(ref(db, sitePath('settings/alerts')), snap => {
      setSettings(snap.val() ?? null)
    })
    return unsub
  }, [sitePath])

  // Reset state when switching sites
  useEffect(() => {
    deviceWasOnline.current = null
  }, [siteId])

  useEffect(() => {
    function checkDevice() {
      const cfg      = settingsRef.current
      const lastSeen = lastSeenRef.current
      if (!cfg?.telegram?.token || !cfg?.telegram?.chatId || !lastSeen) return
      if (!cfg.offlineEnabled) return
      const thresholdMs = (cfg.offlineMinutes ?? 5) * 60 * 1000
      const isOnline    = Date.now() - lastSeen < thresholdMs
      const wasOnline   = deviceWasOnline.current
      if (wasOnline === null) { deviceWasOnline.current = isOnline; return }
      if (!isOnline && wasOnline) {
        if (Date.now() - getLastAlert(`${siteId}_device`) > COOLDOWN_MS) {
          const mins = Math.round((Date.now() - lastSeen) / 60000)
          sendTelegram(cfg.telegram.token, cfg.telegram.chatId,
            `🔴 <b>Device Offline</b>\n\n<b>${deviceName}</b> has not reported in <b>${mins} min</b>.\nTime: ${new Date().toLocaleString()}\n\nCheck WiFi connection or power supply.`)
          setLastAlert(`${siteId}_device`)
        }
      } else if (isOnline && wasOnline === false) {
        sendTelegram(cfg.telegram.token, cfg.telegram.chatId,
          `🟢 <b>Device Back Online</b>\n\n<b>${deviceName}</b> reconnected successfully.\nTime: ${new Date().toLocaleString()}`)
        clearLastAlert(`${siteId}_device`)
      }
      deviceWasOnline.current = isOnline
    }
    checkDevice()
    const timer = setInterval(checkDevice, 60 * 1000)
    return () => clearInterval(timer)
  }, [siteId])

  // Return zone monitors — caller renders these to trigger per-zone alerts
  return zones.map(zone =>
    createElement(ZoneAlertMonitor, { key: zone.id, zone, settings, siteId })
  )
}
