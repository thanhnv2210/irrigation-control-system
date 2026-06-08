import { useEffect, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import { useSite } from '../context/SiteContext'

export function useZoneData(zoneId) {
  const { sitePath } = useSite()
  const [sensor,   setSensor]   = useState(null)
  const [valve,    setValve]    = useState(null)
  const [command,  setCommand]  = useState(null)
  const [schedule, setSchedule] = useState({})

  useEffect(() => {
    const unsubSensor   = onValue(ref(db, sitePath(`zones/${zoneId}/sensor`)),   snap => setSensor(snap.val()))
    const unsubValve    = onValue(ref(db, sitePath(`zones/${zoneId}/valve`)),    snap => setValve(snap.val()))
    const unsubCommand  = onValue(ref(db, sitePath(`zones/${zoneId}/command`)),  snap => setCommand(snap.val()))
    const unsubSchedule = onValue(ref(db, sitePath(`zones/${zoneId}/schedule`)), snap => setSchedule(snap.val() ?? {}))
    return () => { unsubSensor(); unsubValve(); unsubCommand(); unsubSchedule() }
  }, [zoneId, sitePath])

  return { sensor, valve, command, schedule }
}

export function useDeviceData(deviceId) {
  const { sitePath } = useSite()
  const [device, setDevice] = useState(null)

  useEffect(() => {
    const unsub = onValue(ref(db, sitePath(`devices/${deviceId}`)), snap => setDevice(snap.val()))
    return unsub
  }, [deviceId, sitePath])

  return device
}
