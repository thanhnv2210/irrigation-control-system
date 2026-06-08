import { useEffect, useState } from 'react'
import { ref, query, orderByChild, limitToLast, startAt, endAt, onValue } from 'firebase/database'
import { db } from '../firebase'
import { useSite } from '../context/SiteContext'

export function useHistory(zoneId, limit = 48) {
  const { sitePath } = useSite()
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const histRef = query(
      ref(db, sitePath(`zones/${zoneId}/history`)),
      orderByChild('timestamp'),
      limitToLast(limit)
    )
    const unsub = onValue(histRef, snap => {
      if (!snap.exists()) { setHistory([]); setLoading(false); return }
      const entries = Object.values(snap.val()).sort((a, b) => a.timestamp - b.timestamp)
      setHistory(entries)
      setLoading(false)
    })
    return unsub
  }, [zoneId, limit, sitePath])

  return { history, loading }
}

export function useHistoryByDate(zoneId, dateStr) {
  const { sitePath } = useSite()
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!dateStr) { setHistory([]); setLoading(false); return }
    setLoading(true)
    const [year, month, day] = dateStr.split('-').map(Number)
    const startTs = new Date(year, month - 1, day, 0, 0, 0, 0).getTime()
    const endTs   = new Date(year, month - 1, day, 23, 59, 59, 999).getTime()

    const histRef = query(
      ref(db, sitePath(`zones/${zoneId}/history`)),
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
  }, [zoneId, dateStr, sitePath])

  return { history, loading }
}
