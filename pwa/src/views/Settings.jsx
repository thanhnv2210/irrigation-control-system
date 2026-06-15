import { useState } from 'react'
import { auth } from '../firebase'
import { useSite } from '../context/SiteContext'
import { useAuth } from '../App'

// ── User Profile ─────────────────────────────────────────────────────────────
function UserProfile() {
  const user = auth.currentUser
  if (!user) return null

  const joined = user.metadata?.creationTime
    ? new Date(user.metadata.creationTime).toLocaleDateString()
    : '—'
  const lastLogin = user.metadata?.lastSignInTime
    ? new Date(user.metadata.lastSignInTime).toLocaleString()
    : '—'

  return (
    <div style={styles.card}>
      <span style={styles.cardTitle}>User Profile</span>

      <div style={styles.fieldList}>
        <div style={styles.field}>
          <span style={styles.fieldLabel}>Email</span>
          <span style={styles.fieldValue}>{user.email}</span>
        </div>
        {user.displayName && (
          <div style={styles.field}>
            <span style={styles.fieldLabel}>Name</span>
            <span style={styles.fieldValue}>{user.displayName}</span>
          </div>
        )}
        <div style={styles.field}>
          <span style={styles.fieldLabel}>UID</span>
          <span style={{ ...styles.fieldValue, ...styles.mono }}>{user.uid}</span>
        </div>
        <div style={styles.field}>
          <span style={styles.fieldLabel}>Account created</span>
          <span style={styles.fieldValue}>{joined}</span>
        </div>
        <div style={styles.field}>
          <span style={styles.fieldLabel}>Last sign-in</span>
          <span style={styles.fieldValue}>{lastLogin}</span>
        </div>
      </div>

      <p style={{ color: '#7aab90', fontSize: '0.78rem', margin: 0 }}>
        To sign out, open the ☰ menu.
      </p>
    </div>
  )
}

// ── Site Management ───────────────────────────────────────────────────────────
function SiteManagement() {
  const { siteId, setSiteId, sites, createSite, renameSite, deleteSite } = useSite()

  const [newName,   setNewName]   = useState('')
  const [creating,  setCreating]  = useState(false)
  const [renamingId, setRenamingId] = useState(null)
  const [editName,  setEditName]  = useState('')

  const siteList = Object.entries(sites)

  async function handleCreate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    await createSite(newName.trim())
    setNewName('')
    setCreating(false)
  }

  function startRename(id, currentName) {
    setRenamingId(id)
    setEditName(currentName)
  }

  async function handleRename(e) {
    e.preventDefault()
    if (!editName.trim()) return
    await renameSite(renamingId, editName.trim())
    setRenamingId(null)
  }

  async function handleDelete(id) {
    const name = sites[id]?.meta?.name || id
    if (!confirm(`Delete "${name}"? This removes all its data permanently.`)) return
    await deleteSite(id)
  }

  return (
    <div style={styles.card}>
      <span style={styles.cardTitle}>Site Management</span>
      <p style={styles.hint}>
        Each site is an independent location with its own zones, schedules, and device.
        Switch the active site using the header selector.
      </p>

      <div style={styles.siteList}>
        {siteList.map(([id, s]) => {
          const name    = s?.meta?.name || id
          const isActive = id === siteId
          const isRenaming = renamingId === id

          return (
            <div key={id} style={{ ...styles.siteRow, borderColor: isActive ? '#1a7f4b' : '#2e4a38' }}>
              <span style={{ ...styles.activeDot, background: isActive ? '#1a7f4b' : 'transparent', border: isActive ? 'none' : '1px solid #3a5a45' }} />

              {isRenaming ? (
                <form onSubmit={handleRename} style={styles.inlineForm}>
                  <input
                    autoFocus
                    style={styles.inlineInput}
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => e.key === 'Escape' && setRenamingId(null)}
                  />
                  <button style={styles.inlineSave} type="submit">✓</button>
                  <button style={styles.inlineCancel} type="button" onClick={() => setRenamingId(null)}>✕</button>
                </form>
              ) : (
                <>
                  <button
                    style={{ ...styles.siteName, ...(isActive ? styles.siteNameActive : {}) }}
                    onClick={() => setSiteId(id)}
                  >
                    {name}
                    {isActive && <span style={styles.activePill}>active</span>}
                  </button>
                  <div style={styles.siteActions}>
                    <button style={styles.iconBtn} onClick={() => startRename(id, name)} title="Rename">✎</button>
                    <button
                      style={{ ...styles.iconBtn, ...styles.iconBtnDanger }}
                      onClick={() => handleDelete(id)}
                      title="Delete site"
                    >🗑</button>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      {creating ? (
        <form onSubmit={handleCreate} style={styles.addForm}>
          <input
            autoFocus
            style={styles.addInput}
            placeholder="New site name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && setCreating(false)}
          />
          <button style={{ ...styles.btn, background: '#1a7f4b' }} type="submit">Add</button>
          <button style={{ ...styles.btn, background: 'transparent', border: '1px solid #3a5a45', color: '#7aab90' }} type="button" onClick={() => setCreating(false)}>Cancel</button>
        </form>
      ) : (
        <button style={{ ...styles.btn, background: '#1a7f4b', marginTop: '0.75rem' }} onClick={() => setCreating(true)}>
          + Add Site
        </button>
      )}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function Settings() {
  const { isGuest } = useAuth()
  return (
    <div style={styles.page}>
      <UserProfile />
      {!isGuest && <SiteManagement />}
    </div>
  )
}

const styles = {
  page:            { display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' },
  card:            { background: '#1e2d24', borderRadius: '12px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  cardTitle:       { color: '#e0f0e8', fontSize: '1rem', fontWeight: 700 },
  hint:            { color: '#7aab90', fontSize: '0.8rem', margin: 0 },

  // Profile
  fieldList:       { display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  field:           { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem', borderBottom: '1px solid #2e4a38', paddingBottom: '0.35rem' },
  fieldLabel:      { color: '#7aab90', fontSize: '0.78rem', flexShrink: 0 },
  fieldValue:      { color: '#e0f0e8', fontSize: '0.82rem', textAlign: 'right', wordBreak: 'break-all' },
  mono:            { fontFamily: 'monospace', fontSize: '0.72rem', color: '#a0c8b0' },

  // Site list
  siteList:        { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  siteRow:         { display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#162a1e', borderRadius: '8px', padding: '0.6rem 0.75rem', border: '1px solid #2e4a38' },
  activeDot:       { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  siteName:        { flex: 1, background: 'transparent', border: 'none', color: '#a0c8b0', fontSize: '0.9rem', fontWeight: 500, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: 0 },
  siteNameActive:  { color: '#e0f0e8', fontWeight: 600 },
  activePill:      { background: '#1a3d28', color: '#1a7f4b', fontSize: '0.65rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: '4px', border: '1px solid #1a7f4b' },
  siteActions:     { display: 'flex', gap: '0.3rem', flexShrink: 0 },
  iconBtn:         { background: 'transparent', border: '1px solid #3a5a45', borderRadius: '6px', color: '#7aab90', fontSize: '0.85rem', padding: '0.4rem 0.6rem', cursor: 'pointer' },
  iconBtnDanger:   { borderColor: '#e05c3a', color: '#e05c3a' },

  // Inline rename
  inlineForm:      { display: 'flex', alignItems: 'center', gap: '0.4rem', flex: 1 },
  inlineInput:     { background: '#0f1f15', border: '1px solid #3a5a45', borderRadius: '6px', color: '#e0f0e8', fontSize: '0.95rem', padding: '0.4rem 0.6rem', flex: 1, outline: 'none' },
  inlineSave:      { background: '#1a7f4b', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '0.85rem', padding: '0.4rem 0.6rem', cursor: 'pointer' },
  inlineCancel:    { background: 'transparent', border: '1px solid #3a5a45', borderRadius: '6px', color: '#7aab90', fontSize: '0.85rem', padding: '0.4rem 0.6rem', cursor: 'pointer' },

  // Add form
  addForm:         { display: 'flex', gap: '0.4rem', marginTop: '0.75rem' },
  addInput:        { background: '#0f1f15', border: '1px solid #3a5a45', borderRadius: '8px', color: '#e0f0e8', fontSize: '0.9rem', padding: '0.45rem 0.75rem', flex: 1, outline: 'none' },
  btn:             { padding: '0.45rem 0.9rem', borderRadius: '8px', border: 'none', color: '#fff', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', flexShrink: 0 },
}
