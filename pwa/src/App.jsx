import { useState } from 'react'
import Dashboard from './views/Dashboard'
import Control   from './views/Control'
import Schedule  from './views/Schedule'

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'control',   label: 'Control'   },
  { id: 'schedule',  label: 'Schedule'  }
]

export default function App() {
  const [tab, setTab] = useState('dashboard')

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
  app:       { display: 'flex', flexDirection: 'column', height: '100dvh', background: '#0f1f15', color: '#e0f0e8', fontFamily: 'system-ui, sans-serif', maxWidth: '480px', margin: '0 auto' },
  header:    { padding: '1rem', borderBottom: '1px solid #1e2d24', flexShrink: 0 },
  title:     { fontSize: '1.2rem', fontWeight: 700, color: '#1a7f4b' },
  main:      { flex: 1, overflowY: 'auto' },
  nav:       { display: 'flex', borderTop: '1px solid #1e2d24', flexShrink: 0 },
  navBtn:    { flex: 1, padding: '0.9rem 0', background: 'transparent', border: 'none', color: '#7aab90', fontSize: '0.85rem', cursor: 'pointer' },
  navActive: { color: '#1a7f4b', borderTop: '2px solid #1a7f4b', fontWeight: 600 }
}
