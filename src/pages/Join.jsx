import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth'
import { auth, db } from '../lib/firebase'

export default function Join() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [activating, setActivating] = useState(false)
  const [error, setError] = useState(null)
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState({ username: '', email: '', password: '' })

  // Decode preset from URL if present
  const presetParam = searchParams.get('preset')
  const [preset, setPreset] = useState(null)

  useEffect(() => {
    if (presetParam) {
      try {
        const decoded = JSON.parse(atob(presetParam))
        setPreset(decoded)
        setForm({ username: decoded.username, email: decoded.email, password: decoded.password })
      } catch {
        setError('This invite link is invalid.')
      }
    }
  }, [presetParam])

  async function handleActivate(e) {
    e?.preventDefault()
    setActivating(true)
    setError(null)
    try {
      const { user } = await createUserWithEmailAndPassword(auth, form.email, form.password)
      await updateProfile(user, { displayName: form.username })
      await setDoc(doc(db, 'profiles', user.uid), {
        username: form.username,
        email: form.email,
        isAdmin: false,
        createdAt: serverTimestamp(),
      })
      navigate('/')
    } catch (e) {
      let msg = e.message
      if (e.code === 'auth/email-already-in-use') msg = 'An account with this email already exists. Please sign in instead.'
      if (e.code === 'auth/weak-password') msg = 'Password must be at least 6 characters.'
      if (e.code === 'auth/invalid-email') msg = 'Please enter a valid email address.'
      setError(msg)
      setActivating(false)
    }
  }

  if (error && !preset && presetParam) return (
    <div className="page" style={{ maxWidth: 420, textAlign: 'center', paddingTop: '4rem' }}>
      <div style={{ fontSize: 52, marginBottom: 16 }}>😕</div>
      <div className="alert alert-error" style={{ marginBottom: 20 }}>{error}</div>
      <Link to="/auth"><button className="btn-primary">Go to sign in</button></Link>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>

        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: 56 }}>🏴‍☠️</div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: 'var(--primary)', marginTop: 10, marginBottom: 8 }}>
            {preset ? `Welcome, ${preset.username}!` : "You're invited!"}
          </h1>
          <p style={{ color: 'var(--text2)', fontSize: 14, lineHeight: 1.6 }}>
            {preset
              ? 'Your account has been set up. Tap below to activate it and start playing.'
              : 'Create your account to join the treasure hunt.'}
          </p>
        </div>

        <div className="card">
          {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

          {preset ? (
            <div>
              <div style={{
                background: 'var(--surface2)', border: '2px solid var(--border)',
                borderRadius: 10, padding: '0.875rem 1rem', marginBottom: 20
              }}>
                <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 700, marginBottom: 6 }}>YOUR ACCOUNT</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                  <span style={{ color: 'var(--text2)' }}>Username</span>
                  <span style={{ fontWeight: 800, color: 'var(--primary)' }}>{preset.username}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 4 }}>
                  <span style={{ color: 'var(--text2)' }}>Email</span>
                  <span style={{ fontWeight: 600 }}>{preset.email}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, marginTop: 4 }}>
                  <span style={{ color: 'var(--text2)' }}>Password</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 600, fontFamily: 'monospace', letterSpacing: showPassword ? 0 : 2 }}>
                      {showPassword ? preset.password : '••••••••'}
                    </span>
                    <button
                      onClick={() => setShowPassword(s => !s)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '2px 4px', color: 'var(--text3)' }}
                    >{showPassword ? '🙈' : '👁️'}</button>
                  </span>
                </div>
              </div>
              <button
                className="btn-primary"
                style={{ width: '100%', fontSize: 16, padding: '0.75rem' }}
                onClick={handleActivate}
                disabled={activating}
              >
                {activating
                  ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><span className="spinner" style={{ width: 16, height: 16 }} /> Activating…</span>
                  : '🚀 Activate my account'}
              </button>
            </div>
          ) : (
            <form onSubmit={handleActivate}>
              <div className="form-group">
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)' }}>Username</label>
                <input
                  placeholder="Your name in the hunt"
                  required
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)' }}>Email</label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)' }}>Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required minLength={6}
                    placeholder="At least 6 characters"
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    style={{ paddingRight: '2.5rem' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(s => !s)}
                    style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: 0 }}
                  >{showPassword ? '🙈' : '👁️'}</button>
                </div>
              </div>
              <button
                className="btn-primary"
                type="submit"
                style={{ width: '100%', fontSize: 15, padding: '0.7rem', marginTop: 4 }}
                disabled={activating}
              >
                {activating
                  ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><span className="spinner" style={{ width: 16, height: 16 }} /> Creating account…</span>
                  : '🚀 Create my account'}
              </button>
            </form>
          )}
        </div>

        <p style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: 'var(--text3)' }}>
          Already have an account?{' '}
          <Link to="/auth" style={{ color: 'var(--primary)', fontWeight: 700 }}>Sign in</Link>
        </p>
      </div>
    </div>
  )
}
