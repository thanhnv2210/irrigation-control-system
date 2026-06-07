import { useEffect, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'

export function useZoneData(zoneId) {
  const [sensor,  setSensor]  = useState(null)
  const [valve,   setValve]   = useState(null)
  const [command, setCommand] = useState(null)
  const [schedule, setSchedule] = useState({})

  useEffect(() => {
    const sensorRef   = ref(db, `irrigation/zones/${zoneId}/sensor`)
    const valveRef    = ref(db, `irrigation/zones/${zoneId}/valve`)
    const commandRef  = ref(db, `irrigation/zones/${zoneId}/command`)
    const scheduleRef = ref(db, `irrigation/zones/${zoneId}/schedule`)

    const unsubSensor   = onValue(sensorRef,   snap => setSensor(snap.val()))
    const unsubValve    = onValue(valveRef,     snap => setValve(snap.val()))
    const unsubCommand  = onValue(commandRef,   snap => setCommand(snap.val()))
    const unsubSchedule = onValue(scheduleRef,  snap => setSchedule(snap.val() ?? {}))

    return () => {
      unsubSensor()
      unsubValve()
      unsubCommand()
      unsubSchedule()
    }
  }, [zoneId])

  return { sensor, valve, command, schedule }
}

export function useDeviceData(deviceId) {
  const [device, setDevice] = useState(null)

  useEffect(() => {
    const deviceRef = ref(db, `irrigation/devices/${deviceId}`)
    const unsub = onValue(deviceRef, snap => setDevice(snap.val()))
    return unsub
  }, [deviceId])

  return device
}
