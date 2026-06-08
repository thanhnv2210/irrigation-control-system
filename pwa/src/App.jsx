import { useState, useEffect } from 'react'
import { auth, signIn, onAuthStateChanged } from './firebase'
import Dashboard  from './views/Dashboard'
import Control    from './views/Control'
import Schedule   from './views/Schedule'
import Statistics from './views/Statistics'
import Simulator  from './views/Simulator'
import Alerts     from './views/Alerts'
import AuditLog   from './views/AuditLog'
import MapView    from './views/MapView'
import { useAlertMonitor } from './hooks/useAlertMonitor'
import { SiteProvider, useSite } from './context/SiteContext'

const TABS = [
  { id: 'dashboard',  label: 'Dash'    },
  { id: 'control',    label: 'Control' },
  { id: 'schedule',   label: 'Sched'   },
  { id: 'map',        label: 'Map'     },
  { id: 'statistics', label: 'Stats'   },
  { id: 'alerts',     label: 'Alerts'  },
  { id: 'auditlog',   label: 'Log'     },
  { id: 'simulator',  label: 'Sim'     },
]

function LoginScreen({ onLogin }) {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await onLogin(email, password)
    } catch (err) {
      setError('Invalid email or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.loginPage}>
      <div style={styles.loginBox}>
        <h2 style={styles.loginTitle}>Irrigation Control</h2>
        <form onSubmit={handleSubmit} style={styles.form}>
          <input style={styles.input} type="email" placeholder="Email"
            value={email} onChange={e => setEmail(e.target.value)} required />
          <input style={styles.input} type="password" placeholder="Password"
            value={password} onChange={e => setPassword(e.target.value)} required />
          {error && <p style={styles.error}>{error}</p>}
          <button style={styles.loginBtn} type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}

function AlertMonitor() {
  useAlertMonitor()
  return null
}

// Site switcher shown in the header
function SiteSwitcher() {
  const { siteId, setSiteId, sites, createSite, deleteSite } = useSite()
  const [creating, setCreating] = useState(false)
  const [newName,  setNewName]  = useState('')

  const siteList = Object.entries(sites)

  async function handleCreate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    await createSite(newName.trim())
    setNewName('')
    setCreating(false)
  }

  async function handleDelete() {
    const name = sites[siteId]?.meta?.name || siteId
    if (!confirm(`Delete "${name}"? This removes all its data permanently.`)) return
    await deleteSite(siteId)
  }

  if (siteList.length <= 1 && !creating) {
    const currentName = sites[siteId]?.meta?.name || siteId
    return (
      <div style={styles.siteRow}>
        <span style={styles.siteName}>{currentName}</span>
        <button style={styles.siteAddBtn} onClick={() => setCreating(true)}>+ Site</button>
      </div>
    )
  }

  if (creating) {
    return (
      <form onSubmit={handleCreate} style={styles.siteRow}>
        <input
          autoFocus
          style={styles.siteInput}
          placeholder="Site name…"
          value={newName}
          onChange={e => setNewName(e.target.value)}
        />
        <button style={styles.siteAddBtn} type="submit">Add</button>
        <button style={styles.siteCancelBtn} type="button" onClick={() => setCreating(false)}>✕</button>
      </form>
    )
  }

  return (
    <div style={styles.siteRow}>
      <select
        style={styles.siteSelect}
        value={siteId}
        onChange={e => setSiteId(e.target.value)}
      >
        {siteList.map(([id, s]) => (
          <option key={id} value={id}>{s?.meta?.name || id}</option>
        ))}
      </select>
      <button style={styles.siteAddBtn} onClick={() => setCreating(true)}>+ Site</button>
      <button style={styles.siteDeleteBtn} onClick={handleDelete} title="Delete this site">🗑</button>
    </div>
  )
}

function AppShell() {
  const [tab,  setTab]  = useState('dashboard')
  const [user, setUser] = useState(undefined)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => setUser(u ?? null))
    return unsub
  }, [])

  if (user === undefined) return <div style={styles.loading}>Loading...</div>
  if (!user)              return <LoginScreen onLogin={signIn} />

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <span style={styles.title}>Irrigation</span>
        <SiteSwitcher />
      </header>

      <AlertMonitor />

      <main style={styles.main}>
        {tab === 'dashboard'  && <Dashboard />}
        {tab === 'control'    && <Control />}
        {tab === 'schedule'   && <Schedule />}
        {tab === 'statistics' && <Statistics />}
        {tab === 'map'        && <MapView />}
        {tab === 'alerts'     && <Alerts />}
        {tab === 'auditlog'   && <AuditLog />}
        {tab === 'simulator'  && <Simulator />}
      </main>

      <nav style={styles.nav}>
        {TABS.map(t => (
          <button key={t.id}
            style={{ ...styles.navBtn, ...(tab === t.id ? styles.navActive : {}) }}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  return (
    <SiteProvider>
      <AppShell />
    </SiteProvider>
  )
}

const styles = {
  app:           { display: 'flex', flexDirection: 'column', height: '100dvh', background: '#0f1f15', color: '#e0f0e8', fontFamily: 'system-ui, sans-serif', maxWidth: '480px', margin: '0 auto' },
  header:        { padding: '0.75rem 1rem', borderBottom: '1px solid #1e2d24', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' },
  title:         { fontSize: '1.2rem', fontWeight: 700, color: '#1a7f4b', flexShrink: 0 },
  siteRow:       { display: 'flex', alignItems: 'center', gap: '0.4rem', flex: 1, justifyContent: 'flex-end' },
  siteName:      { color: '#a0c8b0', fontSize: '0.82rem', fontWeight: 500 },
  siteSelect:    { background: '#1e2d24', border: '1px solid #3a5a45', borderRadius: '6px', color: '#e0f0e8', fontSize: '0.8rem', padding: '0.3rem 0.5rem', flex: 1, maxWidth: '160px' },
  siteInput:     { background: '#1e2d24', border: '1px solid #3a5a45', borderRadius: '6px', color: '#e0f0e8', fontSize: '0.8rem', padding: '0.3rem 0.5rem', flex: 1, outline: 'none' },
  siteAddBtn:    { background: '#1a7f4b', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '0.75rem', padding: '0.3rem 0.6rem', cursor: 'pointer', flexShrink: 0 },
  siteCancelBtn: { background: 'transparent', border: '1px solid #3a5a45', borderRadius: '6px', color: '#7aab90', fontSize: '0.75rem', padding: '0.3rem 0.5rem', cursor: 'pointer', flexShrink: 0 },
  siteDeleteBtn: { background: 'transparent', border: '1px solid #e05c3a', borderRadius: '6px', color: '#e05c3a', fontSize: '0.75rem', padding: '0.3rem 0.5rem', cursor: 'pointer', flexShrink: 0 },
  main:          { flex: 1, overflowY: 'auto' },
  nav:           { display: 'flex', borderTop: '1px solid #1e2d24', flexShrink: 0 },
  navBtn:        { flex: 1, padding: '0.9rem 0', background: 'transparent', border: 'none', color: '#7aab90', fontSize: '0.75rem', cursor: 'pointer' },
  navActive:     { color: '#1a7f4b', borderTop: '2px solid #1a7f4b', fontWeight: 600 },
  loading:       { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: '#0f1f15', color: '#7aab90', fontFamily: 'system-ui, sans-serif' },
  loginPage:     { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: '#0f1f15', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  loginBox:      { width: '100%', maxWidth: '360px', background: '#1e2d24', borderRadius: '16px', padding: '2rem' },
  loginTitle:    { color: '#1a7f4b', margin: '0 0 1.5rem', fontSize: '1.4rem', fontWeight: 700, textAlign: 'center' },
  form:          { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  input:         { background: '#0f1f15', border: '1px solid #3a5a45', borderRadius: '8px', padding: '0.75rem 1rem', color: '#e0f0e8', fontSize: '1rem', outline: 'none' },
  error:         { color: '#e05c3a', fontSize: '0.85rem', margin: 0, textAlign: 'center' },
  loginBtn:      { background: '#1a7f4b', color: '#fff', border: 'none', borderRadius: '8px', padding: '0.8rem', fontSize: '1rem', fontWeight: 600, cursor: 'pointer', marginTop: '0.25rem' }
}
