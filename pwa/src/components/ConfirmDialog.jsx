export default function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div style={styles.overlay}>
      <div style={styles.box}>
        <p style={styles.message}>{message}</p>
        <div style={styles.actions}>
          <button style={styles.cancel} onClick={onCancel}>Cancel</button>
          <button style={styles.confirm} onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 100,
    padding: '1rem'
  },
  box: {
    background: '#1e2d24',
    borderRadius: '12px',
    padding: '1.5rem',
    width: '100%',
    maxWidth: '320px'
  },
  message: {
    color: '#e0f0e8',
    fontSize: '1rem',
    marginBottom: '1.5rem',
    lineHeight: 1.5
  },
  actions: {
    display: 'flex',
    gap: '0.75rem',
    justifyContent: 'flex-end'
  },
  cancel: {
    padding: '0.6rem 1.2rem',
    borderRadius: '8px',
    border: '1px solid #3a5a45',
    background: 'transparent',
    color: '#a0c8b0',
    fontSize: '0.95rem',
    cursor: 'pointer'
  },
  confirm: {
    padding: '0.6rem 1.2rem',
    borderRadius: '8px',
    border: 'none',
    background: '#1a7f4b',
    color: '#fff',
    fontSize: '0.95rem',
    fontWeight: 600,
    cursor: 'pointer'
  }
}
