import { useEffect, useState } from 'react'
import { ref, query, orderByChild, startAt, endAt, onValue } from 'firebase/database'
import { db } from '../firebase'
import { useSite } from '../context/SiteContext'

export function useHistory({ zoneId, deviceId }, windowMs) {
  const { sitePath } = useSite()
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!zoneId || !deviceId) return
    const startTs = Date.now() - windowMs
    const histRef = query(
      ref(db, sitePath(`devices/${deviceId}/zones/${zoneId}/history`)),
      orderByChild('timestamp'),
      startAt(startTs)
    )
    const unsub = onValue(histRef, snap => {
      if (!snap.exists()) { setHistory([]); setLoading(false); return }
      const entries = Object.values(snap.val()).sort((a, b) => a.timestamp - b.timestamp)
      setHistory(entries)
      setLoading(false)
    })
    return unsub
  }, [zoneId, deviceId, windowMs, sitePath])

  return { history, loading }
}

export function useHistoryByDate({ zoneId, deviceId }, dateStr) {
  const { sitePath } = useSite()
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!dateStr || !zoneId || !deviceId) { setHistory([]); setLoading(false); return }
    setLoading(true)
    const [year, month, day] = dateStr.split('-').map(Number)
    const startTs = new Date(year, month - 1, day, 0, 0, 0, 0).getTime()
    const endTs   = new Date(year, month - 1, day, 23, 59, 59, 999).getTime()

    const histRef = query(
      ref(db, sitePath(`devices/${deviceId}/zones/${zoneId}/history`)),
      orderByChild('timestamp'),
      startAt(startTs),
      endAt(endTs)
    )
    const unsub = onValue(histRef, snap => {
      if (!snap.exists()) { setHistory([]); setLoading(false); return }
      const entries = Object.values(snap.val()).sort((a, b) => a.timestamp - b.timestamp)
      setHistory(entries)
      setLoading(false)
    })
    return unsub
  }, [zoneId, deviceId, dateStr, sitePath])

  return { history, loading }
}
