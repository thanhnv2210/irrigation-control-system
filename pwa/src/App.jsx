import { useState, useEffect } from 'react'
import { auth, signIn, signOut, onAuthStateChanged } from './firebase'
import Dashboard  from './views/Dashboard'
import Control    from './views/Control'
import Schedule   from './views/Schedule'
import Statistics from './views/Statistics'
import Simulator  from './views/Simulator'
import Alerts     from './views/Alerts'
import AuditLog   from './views/AuditLog'
import MapView    from './views/MapView'
import Settings   from './views/Settings'
import { useAlertMonitor } from './hooks/useAlertMonitor'
import { SiteProvider, useSite } from './context/SiteContext'

// Bottom nav — daily-use views
const NAV_TABS = [
  { id: 'dashboard',  label: 'Dashboard', icon: '🌿' },
  { id: 'control',    label: 'Control',   icon: '💧' },
  { id: 'schedule',   label: 'Schedule',  icon: '🗓' },
  { id: 'statistics', label: 'Stats',     icon: '📊' },
]

// Drawer menu — utility / config views
const MENU_ITEMS = [
  { id: 'map',       label: 'Garden Map',  icon: '🗺' },
  { id: 'alerts',    label: 'Alerts',      icon: '🔔' },
  { id: 'auditlog',  label: 'Audit Log',   icon: '📋' },
  { id: 'simulator', label: 'Simulator',   icon: '🧪' },
  { id: 'settings',  label: 'Settings',    icon: '⚙️' },
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
    } catch {
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

function SiteSwitcher() {
  const { siteId, setSiteId, sites } = useSite()
  const siteList = Object.entries(sites)
  const currentName = sites[siteId]?.meta?.name || siteId

  if (siteList.length <= 1) {
    return <span style={styles.siteName}>{currentName}</span>
  }

  return (
    <select
      style={styles.siteSelect}
      value={siteId}
      onChange={e => setSiteId(e.target.value)}
    >
      {siteList.map(([id, s]) => (
        <option key={id} value={id}>{s?.meta?.name || id}</option>
      ))}
    </select>
  )
}

function Drawer({ open, onClose, tab, setTab, user }) {
  const allItems = [...MENU_ITEMS]

  async function handleSignOut() {
    if (!confirm('Sign out?')) return
    await signOut()
  }

  function navigate(id) {
    setTab(id)
    onClose()
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div style={styles.backdrop} onClick={onClose} />
      )}

      {/* Drawer panel */}
      <div style={{ ...styles.drawer, transform: open ? 'translateX(0)' : 'translateX(-100%)' }}>
        {/* User section */}
        <div style={styles.drawerUser}>
          <div style={styles.drawerAvatar}>
            {(user?.displayName || user?.email || '?')[0].toUpperCase()}
          </div>
          <div style={styles.drawerUserInfo}>
            <span style={styles.drawerUserName}>{user?.displayName || 'User'}</span>
            <span style={styles.drawerUserEmail}>{user?.email}</span>
          </div>
        </div>

        {/* Site switcher */}
        <div style={styles.drawerSiteRow}>
          <span style={styles.drawerSiteLabel}>Site</span>
          <SiteSwitcher />
        </div>

        <div style={styles.drawerDivider} />

        {/* Menu items */}
        <nav style={styles.drawerNav}>
          {allItems.map(item => (
            <button
              key={item.id}
              style={{ ...styles.drawerItem, ...(tab === item.id ? styles.drawerItemActive : {}) }}
              onClick={() => navigate(item.id)}
            >
              <span style={styles.drawerIcon}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div style={styles.drawerDivider} />

        {/* Sign out */}
        <button style={styles.signOutBtn} onClick={handleSignOut}>
          <span>⎋</span>
          <span>Sign Out</span>
        </button>
      </div>
    </>
  )
}

function AppShell() {
  const [tab,        setTab]        = useState('dashboard')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [user,       setUser]       = useState(undefined)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => setUser(u ?? null))
    return unsub
  }, [])

  if (user === undefined) return <div style={styles.loading}>Loading...</div>
  if (!user)              return <LoginScreen onLogin={signIn} />

  const isMenuTab = MENU_ITEMS.some(m => m.id === tab)
  const activeMenuLabel = isMenuTab ? MENU_ITEMS.find(m => m.id === tab)?.label : null

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <button style={styles.menuBtn} onClick={() => setDrawerOpen(true)} aria-label="Menu">
          <span style={styles.menuIcon}>☰</span>
        </button>
        <span style={styles.headerTitle}>
          {activeMenuLabel ?? 'Irrigation'}
        </span>
        <div style={styles.headerRight}>
          {!isMenuTab && <SiteSwitcher />}
        </div>
      </header>

      <AlertMonitor />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        tab={tab}
        setTab={setTab}
        user={user}
      />

      <main style={styles.main}>
        {tab === 'dashboard'  && <Dashboard />}
        {tab === 'control'    && <Control />}
        {tab === 'schedule'   && <Schedule />}
        {tab === 'statistics' && <Statistics />}
        {tab === 'map'        && <MapView />}
        {tab === 'alerts'     && <Alerts />}
        {tab === 'auditlog'   && <AuditLog />}
        {tab === 'simulator'  && <Simulator />}
        {tab === 'settings'   && <Settings />}
      </main>

      <nav style={styles.nav}>
        {NAV_TABS.map(t => (
          <button
            key={t.id}
            style={{ ...styles.navBtn, ...(tab === t.id ? styles.navActive : {}) }}
            onClick={() => setTab(t.id)}
          >
            <span style={styles.navIcon}>{t.icon}</span>
            <span style={styles.navLabel}>{t.label}</span>
          </button>
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
  app:            { display: 'flex', flexDirection: 'column', height: '100dvh', background: '#0f1f15', color: '#e0f0e8', fontFamily: 'system-ui, sans-serif', maxWidth: '480px', margin: '0 auto', position: 'relative', overflow: 'hidden' },

  // Header
  header:         { padding: '0 1rem', height: '52px', borderBottom: '1px solid #1e2d24', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' },
  menuBtn:        { background: 'transparent', border: 'none', color: '#e0f0e8', padding: '0.5rem', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center' },
  menuIcon:       { fontSize: '1.3rem', lineHeight: 1 },
  headerTitle:    { flex: 1, fontSize: '1.1rem', fontWeight: 700, color: '#1a7f4b', textAlign: 'center' },
  headerRight:    { flexShrink: 0, minWidth: '40px', display: 'flex', justifyContent: 'flex-end' },
  siteName:       { color: '#a0c8b0', fontSize: '0.82rem', fontWeight: 500 },
  siteSelect:     { background: '#1e2d24', border: '1px solid #3a5a45', borderRadius: '6px', color: '#e0f0e8', fontSize: '0.82rem', padding: '0.35rem 0.5rem', maxWidth: '130px' },

  // Main
  main:           { flex: 1, overflowY: 'auto' },

  // Bottom nav
  nav:            { display: 'flex', borderTop: '1px solid #1e2d24', flexShrink: 0 },
  navBtn:         { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem', padding: '0.7rem 0', background: 'transparent', borderTop: '2px solid transparent', borderRight: 'none', borderBottom: 'none', borderLeft: 'none', color: '#7aab90', cursor: 'pointer' },
  navIcon:        { fontSize: '1.25rem', lineHeight: 1 },
  navLabel:       { fontSize: '0.68rem' },
  navActive:      { color: '#1a7f4b', borderTop: '2px solid #1a7f4b', fontWeight: 600 },

  // Drawer
  backdrop:       { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 10 },
  drawer:         { position: 'absolute', top: 0, left: 0, bottom: 0, width: '78%', maxWidth: '300px', background: '#142a1c', borderRight: '1px solid #2e4a38', zIndex: 11, display: 'flex', flexDirection: 'column', transition: 'transform 0.25s ease', willChange: 'transform' },
  drawerUser:     { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1.25rem 1rem 1rem' },
  drawerAvatar:   { width: '42px', height: '42px', borderRadius: '50%', background: '#1a7f4b', color: '#fff', fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  drawerUserInfo: { display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: 0 },
  drawerUserName: { color: '#e0f0e8', fontWeight: 600, fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  drawerUserEmail:{ color: '#7aab90', fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  drawerSiteRow:  { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0 1rem 0.75rem' },
  drawerSiteLabel:{ color: '#7aab90', fontSize: '0.8rem', flexShrink: 0 },
  drawerDivider:  { height: '1px', background: '#2e4a38', margin: '0 1rem' },
  drawerNav:      { flex: 1, display: 'flex', flexDirection: 'column', padding: '0.5rem 0', overflowY: 'auto' },
  drawerItem:     { display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.9rem 1.25rem', background: 'transparent', border: 'none', color: '#a0c8b0', fontSize: '0.95rem', cursor: 'pointer', textAlign: 'left', width: '100%' },
  drawerItemActive:{ background: '#1e3a28', color: '#e0f0e8', fontWeight: 600 },
  drawerIcon:     { fontSize: '1.15rem', width: '1.5rem', textAlign: 'center', flexShrink: 0 },
  signOutBtn:     { display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '1rem 1.25rem', background: 'transparent', border: 'none', color: '#e05c3a', fontSize: '0.95rem', cursor: 'pointer', width: '100%', marginTop: '0.25rem' },

  // Login
  loading:        { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: '#0f1f15', color: '#7aab90', fontFamily: 'system-ui, sans-serif' },
  loginPage:      { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: '#0f1f15', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  loginBox:       { width: '100%', maxWidth: '360px', background: '#1e2d24', borderRadius: '16px', padding: '2rem' },
  loginTitle:     { color: '#1a7f4b', margin: '0 0 1.5rem', fontSize: '1.4rem', fontWeight: 700, textAlign: 'center' },
  form:           { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  input:          { background: '#0f1f15', border: '1px solid #3a5a45', borderRadius: '8px', padding: '0.75rem 1rem', color: '#e0f0e8', fontSize: '1rem', outline: 'none' },
  error:          { color: '#e05c3a', fontSize: '0.85rem', margin: 0, textAlign: 'center' },
  loginBtn:       { background: '#1a7f4b', color: '#fff', border: 'none', borderRadius: '8px', padding: '0.8rem', fontSize: '1rem', fontWeight: 600, cursor: 'pointer', marginTop: '0.25rem' },
}
