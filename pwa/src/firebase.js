import { initializeApp } from 'firebase/app'
import { getDatabase } from 'firebase/database'
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged } from 'firebase/auth'

const firebaseConfig = {
  apiKey:            'AIzaSyDEAP1XKmK8t1qt4fuXYN2ndZ3pbNNlLTU',
  authDomain:        'smarthomeapp-982da.firebaseapp.com',
  databaseURL:       'https://smarthomeapp-982da-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId:         'smarthomeapp-982da',
  storageBucket:     'smarthomeapp-982da.firebasestorage.app',
  messagingSenderId: '95863619710',
  appId:             '1:95863619710:web:50f331ff02dc5d92bfd82f'
}

const app  = initializeApp(firebaseConfig)
export const db   = getDatabase(app)
export const auth = getAuth(app)

export function signIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password)
}

export { onAuthStateChanged }
