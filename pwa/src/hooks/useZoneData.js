import { useEffect, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import { useSite } from '../context/SiteContext'

export function useZoneData({ zoneId, deviceId }) {
  const { sitePath } = useSite()
  const [sensor,   setSensor]   = useState(null)
  const [valve,    setValve]    = useState(null)
  const [command,  setCommand]  = useState(null)
  const [schedule, setSchedule] = useState({})

  useEffect(() => {
    if (!zoneId || !deviceId) return
    const base = sitePath(`devices/${deviceId}/zones/${zoneId}`)
    const unsubSensor   = onValue(ref(db, `${base}/sensor`),   snap => setSensor(snap.val()))
    const unsubValve    = onValue(ref(db, `${base}/valve`),    snap => setValve(snap.val()))
    const unsubCommand  = onValue(ref(db, `${base}/command`),  snap => setCommand(snap.val()))
    const unsubSchedule = onValue(ref(db, `${base}/schedule`), snap => setSchedule(snap.val() ?? {}))
    return () => { unsubSensor(); unsubValve(); unsubCommand(); unsubSchedule() }
  }, [zoneId, deviceId, sitePath])

  return { sensor, valve, command, schedule }
}

export function useDeviceData(deviceId) {
  const { sitePath } = useSite()
  const [device, setDevice] = useState(null)

  useEffect(() => {
    if (!deviceId) return
    const unsub = onValue(ref(db, sitePath(`devices/${deviceId}/meta`)), snap => setDevice(snap.val()))
    return unsub
  }, [deviceId, sitePath])

  return device
}
