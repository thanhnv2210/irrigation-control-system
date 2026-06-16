/**
 * One-off cleanup script — removes fake sensor/history data for esp32-02.
 * Keeps: meta, config, schedule, valve state, command.
 * Deletes: sensor readings, history.
 *
 * Run from repo root:
 *   node scripts/cleanup-esp32-02.mjs
 */

import { initializeApp } from 'firebase/app'
import { getDatabase, ref, remove, get } from 'firebase/database'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'

const firebaseConfig = {
  apiKey:      'AIzaSyDEAP1XKmK8t1qt4fuXYN2ndZ3pbNNlLTU',
  authDomain:  'smarthomeapp-982da.firebaseapp.com',
  databaseURL: 'https://smarthomeapp-982da-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId:   'smarthomeapp-982da',
}

const SITE_ID   = 'default'
const DEVICE_ID = 'esp32-02'
const ZONES     = ['balcony2', 'garden2']

const app  = initializeApp(firebaseConfig)
const db   = getDatabase(app)
const auth = getAuth(app)

// ── Auth ──────────────────────────────────────────────────────────────────────
// Use your admin account (nguyenvanthanh2210@gmail.com)
const EMAIL    = 'esp32-irrigation@device.local'
const PASSWORD = 'KqEodVoVeUx8JD6qchDrtw=='

async function main() {
  console.log('Signing in...')
  await signInWithEmailAndPassword(auth, EMAIL, PASSWORD)
  console.log('Signed in.\n')

  const basePath = `irrigation/sites/${SITE_ID}/devices/${DEVICE_ID}`

  for (const zoneId of ZONES) {
    const zonePath = `${basePath}/zones/${zoneId}`

    // Preview what exists before deleting
    const sensorSnap  = await get(ref(db, `${zonePath}/sensor`))
    const historySnap = await get(ref(db, `${zonePath}/history`))

    console.log(`Zone: ${zoneId}`)
    console.log(`  sensor  — exists: ${sensorSnap.exists()}`)
    console.log(`  history — exists: ${historySnap.exists()}, entries: ${historySnap.exists() ? Object.keys(historySnap.val()).length : 0}`)

    if (sensorSnap.exists()) {
      await remove(ref(db, `${zonePath}/sensor`))
      console.log(`  ✓ sensor deleted`)
    }
    if (historySnap.exists()) {
      await remove(ref(db, `${zonePath}/history`))
      console.log(`  ✓ history deleted`)
    }
    console.log()
  }

  console.log('Done.')
  process.exit(0)
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
