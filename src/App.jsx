import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AuthProvider, useAuth } from './lib/AuthContext'
import Auth from './pages/Auth'
import Home from './pages/Home'
import Hunt from './pages/Hunt'
import Admin from './pages/Admin'
import Profile from './pages/Profile'
import Join from './pages/Join'
import Avatar from './components/Avatar'

function Nav() {
  const { profile, signOut } = useAuth()
  const { t } = useTranslation()
  return (
    <nav>
      <div className="nav-inner">
        <NavLink to="/" className="nav-logo">🏴‍☠️ Treasure Hunt</NavLink>
        <div className="nav-links">
          {profile?.isAdmin && (
            <NavLink to="/admin">
              <button className="btn-ghost" style={{ fontSize: 13 }}>🛠️ {t('nav.admin')}</button>
            </NavLink>
          )}
          {profile && (
            <NavLink to="/profile" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: 700 }}>
              <Avatar username={profile.username} photoUrl={profile.photoUrl} size={28} />
              {profile.username}
            </NavLink>
          )}
          <button className="btn-ghost" style={{ fontSize: 13 }} onClick={signOut}>
            {t('nav.signOut')}
          </button>
        </div>
      </div>
    </nav>
  )
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ display:'flex', justifyContent:'center', padding:'4rem' }}><div className="spinner" /></div>
  if (!user) return <Navigate to="/auth" replace />
  return children
}

function AppRoutes() {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ display:'flex', justifyContent:'center', padding:'4rem' }}><div className="spinner" /></div>

  return (
    <>
      {user && <Nav />}
      <Routes>
        <Route path="/auth" element={user ? <Navigate to="/" replace /> : <Auth />} />
        <Route path="/join" element={user ? <Navigate to="/" replace /> : <Join />} />
        <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
        <Route path="/hunt/:huntId" element={<ProtectedRoute><Hunt /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      </Routes>
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
