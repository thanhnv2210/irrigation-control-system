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
  const [sites, setSites] = useState({})

  // Watch all sites from Firebase
  useEffect(() => {
    const unsub = onValue(ref(db, 'irrigation/sites'), snap => {
      setSites(snap.val() ?? {})
    })
    return unsub
  }, [])

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

  async function deleteSite(id) {
    await remove(ref(db, `irrigation/sites/${id}`))
    // If we deleted the active site, fall back to default (or first remaining)
    if (siteId === id) {
      const remaining = Object.keys(sites).filter(k => k !== id)
      setSiteId(remaining[0] ?? DEFAULT_SITE)
    }
  }

  return (
    <SiteContext.Provider value={{ siteId, setSiteId, sitePath, sites, createSite, renameSite, deleteSite }}>
      {children}
    </SiteContext.Provider>
  )
}

export function useSite() {
  return useContext(SiteContext)
}
