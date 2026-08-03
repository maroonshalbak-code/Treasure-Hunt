import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import { applyLanguage } from '../lib/i18n'
import Avatar from '../components/Avatar'

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET
const LANGUAGES = ['en', 'ar', 'he']

export default function Profile() {
  const { user, profile, setProfile } = useAuth()
  const { t } = useTranslation()
  const [username, setUsername] = useState(profile?.username || '')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const fileRef = useRef()

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setMsg(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('upload_preset', UPLOAD_PRESET)
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
        method: 'POST', body: form,
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error.message)
      const photoUrl = data.secure_url
      await updateDoc(doc(db, 'profiles', user.uid), { photoUrl })
      setProfile(prev => ({ ...prev, photoUrl }))
      setMsg({ type: 'success', text: t('profile.photoUpdated') })
    } catch (err) {
      setMsg({ type: 'error', text: t('profile.uploadFailed', { error: err.message }) })
    }
    setUploading(false)
  }

  async function handleSave(e) {
    e.preventDefault(); setSaving(true); setMsg(null)
    try {
      await updateDoc(doc(db, 'profiles', user.uid), { username: username.trim() })
      setProfile(prev => ({ ...prev, username: username.trim() }))
      setMsg({ type: 'success', text: t('profile.saved') })
    } catch (err) {
      setMsg({ type: 'error', text: t('profile.saveFailed', { error: err.message }) })
    }
    setSaving(false)
  }

  async function handleLanguageChange(lang) {
    applyLanguage(lang)
    localStorage.setItem('lang', lang)
    setProfile(prev => ({ ...prev, language: lang }))
    await updateDoc(doc(db, 'profiles', user.uid), { language: lang })
  }

  const currentLang = profile?.language || localStorage.getItem('lang') || 'en'

  return (
    <div className="page" style={{ maxWidth: 480 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: '1.5rem' }}>{t('profile.title')}</h1>

      {msg && <div className={`alert alert-${msg.type}`} style={{ marginBottom: '1rem' }}>{msg.text}</div>}

      {/* Photo */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: '1rem' }}>{t('profile.photo')}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Avatar username={profile?.username} photoUrl={profile?.photoUrl} size={72} />
          <div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoChange} />
            <button
              className="btn-primary"
              onClick={() => fileRef.current.click()}
              disabled={uploading}
              style={{ fontSize: 13 }}
            >
              {uploading ? t('profile.uploading') : t('profile.upload')}
            </button>
            <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>{t('profile.photoHint')}</p>
          </div>
        </div>
      </div>

      {/* Username */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: '1rem' }}>{t('profile.displayName')}</h2>
        <form onSubmit={handleSave}>
          <div className="form-group">
            <label>{t('profile.username')}</label>
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              minLength={2}
              maxLength={30}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>{t('profile.email')}</label>
            <input value={user?.email || ''} disabled style={{ opacity: 0.6, cursor: 'not-allowed' }} />
          </div>
          <button className="btn-primary" type="submit" disabled={saving} style={{ marginTop: '1rem' }}>
            {saving ? t('profile.saving') : t('profile.save')}
          </button>
        </form>
      </div>

      {/* Language */}
      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{t('profile.language')}</h2>
        <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: '1rem' }}>{t('profile.languageHint')}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          {LANGUAGES.map(lang => (
            <button
              key={lang}
              onClick={() => handleLanguageChange(lang)}
              className={currentLang === lang ? 'btn-primary' : 'btn-ghost'}
              style={{ flex: 1, fontSize: 14 }}
            >
              {t(`languages.${lang}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
