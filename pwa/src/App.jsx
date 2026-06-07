import { useState, useEffect } from 'react'
import { auth, signIn, onAuthStateChanged } from './firebase'
import Dashboard from './views/Dashboard'
import Control   from './views/Control'
import Schedule  from './views/Schedule'

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'control',   label: 'Control'   },
  { id: 'schedule',  label: 'Schedule'  }
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
          <input
            style={styles.input}
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <input
            style={styles.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          {error && <p style={styles.error}>{error}</p>}
          <button style={styles.loginBtn} type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function App() {
  const [tab,  setTab]  = useState('dashboard')
  const [user, setUser] = useState(undefined)  // undefined = loading, null = signed out

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => setUser(u ?? null))
    return unsub
  }, [])

  // Loading — waiting for Firebase to restore session
  if (user === undefined) {
    return <div style={styles.loading}>Loading...</div>
  }

  // Not signed in — show login screen
  if (!user) {
    return <LoginScreen onLogin={signIn} />
  }

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <span style={styles.title}>Irrigation</span>
      </header>

      <main style={styles.main}>
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'control'   && <Control />}
        {tab === 'schedule'  && <Schedule />}
      </main>

      <nav style={styles.nav}>
        {TABS.map(t => (
          <button
            key={t.id}
            style={{ ...styles.navBtn, ...(tab === t.id ? styles.navActive : {}) }}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

const styles = {
  app:        { display: 'flex', flexDirection: 'column', height: '100dvh', background: '#0f1f15', color: '#e0f0e8', fontFamily: 'system-ui, sans-serif', maxWidth: '480px', margin: '0 auto' },
  header:     { padding: '1rem', borderBottom: '1px solid #1e2d24', flexShrink: 0 },
  title:      { fontSize: '1.2rem', fontWeight: 700, color: '#1a7f4b' },
  main:       { flex: 1, overflowY: 'auto' },
  nav:        { display: 'flex', borderTop: '1px solid #1e2d24', flexShrink: 0 },
  navBtn:     { flex: 1, padding: '0.9rem 0', background: 'transparent', border: 'none', color: '#7aab90', fontSize: '0.85rem', cursor: 'pointer' },
  navActive:  { color: '#1a7f4b', borderTop: '2px solid #1a7f4b', fontWeight: 600 },
  loading:    { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: '#0f1f15', color: '#7aab90', fontFamily: 'system-ui, sans-serif' },
  loginPage:  { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: '#0f1f15', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  loginBox:   { width: '100%', maxWidth: '360px', background: '#1e2d24', borderRadius: '16px', padding: '2rem' },
  loginTitle: { color: '#1a7f4b', margin: '0 0 1.5rem', fontSize: '1.4rem', fontWeight: 700, textAlign: 'center' },
  form:       { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  input:      { background: '#0f1f15', border: '1px solid #3a5a45', borderRadius: '8px', padding: '0.75rem 1rem', color: '#e0f0e8', fontSize: '1rem', outline: 'none' },
  error:      { color: '#e05c3a', fontSize: '0.85rem', margin: 0, textAlign: 'center' },
  loginBtn:   { background: '#1a7f4b', color: '#fff', border: 'none', borderRadius: '8px', padding: '0.8rem', fontSize: '1rem', fontWeight: 600, cursor: 'pointer', marginTop: '0.25rem' }
}
