import { useState } from 'react'
import { useAuth } from '../lib/AuthContext'

export default function Auth() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null); setSuccess(null); setLoading(true)
    if (mode === 'signup') {
      const { error } = await signUp(email, password, username)
      if (error) setError(error.message)
      else setSuccess('Check your email to confirm your account, then sign in.')
    } else {
      const { error } = await signIn(email, password)
      if (error) setError(error.message)
    }
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🗺️</div>
          <h1 style={{ fontSize: 24, fontWeight: 600 }}>Treasure Hunt</h1>
          <p style={{ color: 'var(--text2)', marginTop: 4 }}>
            Find real-world clues. Beat the competition.
          </p>
        </div>

        <div className="card">
          <div className="tab-bar" style={{ marginBottom: '1.25rem' }}>
            <button className={`tab ${mode === 'signin' ? 'active' : ''}`} onClick={() => { setMode('signin'); setError(null); setSuccess(null) }}>
              Sign in
            </button>
            <button className={`tab ${mode === 'signup' ? 'active' : ''}`} onClick={() => { setMode('signup'); setError(null); setSuccess(null) }}>
              Create account
            </button>
          </div>

          {error && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}

          <form onSubmit={handleSubmit}>
            {mode === 'signup' && (
              <div className="form-group">
                <label>Username</label>
                <input
                  type="text" placeholder="explorer42" required
                  value={username} onChange={e => setUsername(e.target.value)}
                  minLength={3} maxLength={30}
                />
              </div>
            )}
            <div className="form-group">
              <label>Email</label>
              <input
                type="email" placeholder="you@example.com" required
                value={email} onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ marginBottom: '1.25rem' }}>
              <label>Password</label>
              <input
                type="password" placeholder="••••••••" required
                value={password} onChange={e => setPassword(e.target.value)}
                minLength={6}
              />
            </div>
            <button type="submit" className="btn-primary" style={{ width: '100%', padding: '0.65rem' }} disabled={loading}>
              {loading ? <span className="spinner" style={{ width:16, height:16 }} /> : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
