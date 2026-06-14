import { createContext, useContext, useState, useEffect } from 'react'
import { ref, onValue, set, push, remove } from 'firebase/database'
import { db } from '../firebase'

const SiteContext = createContext(null)

const STORAGE_KEY = 'irrigCurrentSite'
const DEFAULT_SITE = 'default'

export function SiteProvider({ children }) {
  const [siteId, setSiteIdState] = useState(
    () => localStorage.getItem(STORAGE_KEY) || DEFAULT_SITE
  )
  const [sites,   setSites]   = useState({})
  const [zones,   setZones]   = useState([])
  const [devices, setDevices] = useState([])

  // Watch all sites from Firebase
  useEffect(() => {
    const unsub = onValue(ref(db, 'irrigation/sites'), snap => {
      setSites(snap.val() ?? {})
    })
    return unsub
  }, [])

  // Watch all devices for current site — derive both devices list and zones list
  useEffect(() => {
    const unsub = onValue(ref(db, `irrigation/sites/${siteId}/devices`), snap => {
      const val = snap.val()
      if (!val) { setDevices([]); setZones([]); return }

      const deviceList = Object.entries(val).map(([id, d]) => ({
        id,
        name:      d.meta?.name,
        lastSeen:  d.meta?.lastSeen,
        ipAddress: d.meta?.ipAddress,
        wifiRssi:  d.meta?.wifiRssi,
        firmware:  d.meta?.firmware,
      }))
      setDevices(deviceList)

      // Derive zones by iterating each device's zones sub-tree
      const zoneList = []
      for (const [deviceId, d] of Object.entries(val)) {
        if (!d.zones) continue
        for (const [zoneId, z] of Object.entries(d.zones)) {
          if (!z?.meta) continue
          zoneList.push({ id: zoneId, label: z.meta?.name || zoneId, deviceId })
        }
      }
      setZones(zoneList)
    })
    return unsub
  }, [siteId])

  function setSiteId(id) {
    localStorage.setItem(STORAGE_KEY, id)
    setSiteIdState(id)
  }

  // Helper — builds Firebase path scoped to current site
  function sitePath(subpath) {
    return `irrigation/sites/${siteId}/${subpath}`
  }

  async function createSite(name) {
    const newRef = push(ref(db, 'irrigation/sites'))
    await set(newRef, {
      meta: { name, createdAt: Date.now() }
    })
    setSiteId(newRef.key)
    return newRef.key
  }

  async function renameSite(id, name) {
    await set(ref(db, `irrigation/sites/${id}/meta/name`), name)
  }

  async function renameZone(zoneId, deviceId, name) {
    await set(ref(db, `irrigation/sites/${siteId}/devices/${deviceId}/zones/${zoneId}/meta/name`), name)
  }

  async function renameDevice(deviceId, name) {
    await set(ref(db, `irrigation/sites/${siteId}/devices/${deviceId}/meta/name`), name)
  }

  async function deleteSite(id) {
    await remove(ref(db, `irrigation/sites/${id}`))
    // If we deleted the active site, fall back to default (or first remaining)
    if (siteId === id) {
      const remaining = Object.keys(sites).filter(k => k !== id)
      setSiteId(remaining[0] ?? DEFAULT_SITE)
    }
  }

  return (
    <SiteContext.Provider value={{ siteId, setSiteId, sitePath, sites, zones, devices, createSite, renameSite, deleteSite, renameZone, renameDevice }}>
      {children}
    </SiteContext.Provider>
  )
}

export function useSite() {
  return useContext(SiteContext)
}
