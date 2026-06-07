import { useEffect, useState } from 'react'
import { ref, query, orderByChild, limitToLast, onValue } from 'firebase/database'
import { db } from '../firebase'

// Returns last `limit` history entries for a zone, sorted oldest → newest
export function useHistory(zoneId, limit = 48) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const histRef = query(
      ref(db, `irrigation/zones/${zoneId}/history`),
      orderByChild('timestamp'),
      limitToLast(limit)
    )

    const unsub = onValue(histRef, snap => {
      if (!snap.exists()) {
        setHistory([])
        setLoading(false)
        return
      }
      const entries = Object.values(snap.val())
        .sort((a, b) => a.timestamp - b.timestamp)
      setHistory(entries)
      setLoading(false)
    })

    return unsub
  }, [zoneId, limit])

  return { history, loading }
}
