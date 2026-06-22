/**
 * irrigation-functions/index.js
 *
 * Cloud Function: deviceOfflineCheck
 * Runs every 5 minutes and sends a Telegram alert if any device has not reported
 * within the configured threshold. Fires regardless of whether the PWA is open.
 *
 * Deploy:
 *   firebase deploy --only functions
 *
 * Requires Firebase Blaze (pay-as-you-go) plan for scheduled functions.
 * At 1 invocation per 5 min with minimal RTDB reads, cost is effectively $0.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler')
const admin = require('firebase-admin')

admin.initializeApp()

const COOLDOWN_MS = 60 * 60 * 1000  // 1 hour between repeated offline alerts per device

exports.deviceOfflineCheck = onSchedule('every 5 minutes', async () => {
  const db = admin.database()

  const sitesSnap = await db.ref('irrigation/sites').get()
  if (!sitesSnap.exists()) return

  const sites = sitesSnap.val()

  for (const [siteId, site] of Object.entries(sites)) {
    const settings = site.settings?.alerts
    if (!settings?.telegram?.token || !settings?.telegram?.chatId) continue
    if (!settings.offlineEnabled) continue

    const token  = settings.telegram.token
    const chatId = settings.telegram.chatId
    // Use the same threshold the PWA uses, defaulting to 10 minutes
    const thresholdMs = (settings.offlineMinutes ?? 10) * 60 * 1000

    const devices = site.devices || {}

    for (const [deviceId, device] of Object.entries(devices)) {
      const lastSeen = device.meta?.lastSeen
      if (!lastSeen) continue

      const ageMs    = Date.now() - lastSeen
      const isOffline = ageMs > thresholdMs

      const cooldownPath = `irrigation/sites/${siteId}/alertCooldowns/device_offline_${deviceId}`
      const cooldownSnap = await db.ref(cooldownPath).get()
      const lastAlertMs  = cooldownSnap.val() ?? 0

      if (isOffline && Date.now() - lastAlertMs > COOLDOWN_MS) {
        const mins       = Math.round(ageMs / 60000)
        const deviceName = device.meta?.name || deviceId
        const sent = await sendTelegram(token, chatId,
          `\u{1F534} <b>Device Offline</b>\n\n` +
          `<b>${deviceName}</b> has not reported in <b>${mins} min</b>.\n` +
          `Time: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh' })}\n\n` +
          `Check WiFi connection or power supply.\n` +
          `<i>(Sent by Cloud Function — fires even when the app is closed.)</i>`
        )
        if (sent) {
          await db.ref(cooldownPath).set(Date.now())
          console.log(`[${siteId}/${deviceId}] Offline alert sent — age: ${mins}min`)
        }
      } else if (!isOffline && lastAlertMs > 0) {
        // Device is back online — clear the offline cooldown so the next outage alerts immediately
        await db.ref(cooldownPath).remove()
        console.log(`[${siteId}/${deviceId}] Back online — offline cooldown cleared`)
      }
    }
  }
})

async function sendTelegram(token, chatId, text) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    })
    const data = await res.json()
    if (!data.ok) console.error('Telegram send failed:', JSON.stringify(data))
    return data.ok === true
  } catch (err) {
    console.error('Telegram fetch error:', err)
    return false
  }
}
