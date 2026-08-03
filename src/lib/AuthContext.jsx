import { createContext, useContext, useEffect, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from './firebase'
import { applyLanguage } from './i18n'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)
      if (firebaseUser) {
        const snap = await getDoc(doc(db, 'profiles', firebaseUser.uid))
        const profileData = snap.exists() ? snap.data() : null
        setProfile(profileData)
        if (profileData?.language) {
          localStorage.setItem('lang', profileData.language)
          applyLanguage(profileData.language)
        }
      } else {
        setProfile(null)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  async function signUp(email, password, username) {
    try {
      const { user: newUser } = await createUserWithEmailAndPassword(auth, email, password)
      const profileData = {
        id: newUser.uid,
        username,
        isAdmin: false,
        createdAt: serverTimestamp(),
      }
      await setDoc(doc(db, 'profiles', newUser.uid), profileData)
      setProfile(profileData)
      return { error: null }
    } catch (err) {
      return { error: err }
    }
  }

  async function signIn(email, password) {
    try {
      await signInWithEmailAndPassword(auth, email, password)
      return { error: null }
    } catch (err) {
      return { error: err }
    }
  }

  async function signOut() {
    await firebaseSignOut(auth)
  }

  return (
    <AuthContext.Provider value={{ user, profile, setProfile, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
