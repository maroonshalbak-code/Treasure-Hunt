import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { collection, query, where, getDocs, orderBy, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'

const HUNT_EMOJIS = ['🏆', '💎', '🗝️', '🌟', '🔮', '🎯', '🚀', '🐉']

export default function Home() {
  const { profile, user } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [hunts, setHunts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user || profile === undefined) return

    const q = profile?.isAdmin
      ? query(collection(db, 'hunts'), where('isActive', '==', true), orderBy('createdAt', 'desc'))
      : query(collection(db, 'hunts'), where('allowedUsers', 'array-contains', user.uid))

    const unsub = onSnapshot(q, async (snap) => {
      try {
        let data = await Promise.all(snap.docs.map(async d => {
          const cluesSnap = await getDocs(collection(db, 'hunts', d.id, 'clues'))
          return { id: d.id, ...d.data(), clueCount: cluesSnap.size }
        }))
        if (!profile?.isAdmin) {
          data = data
            .filter(h => h.isActive)
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
        }
        setHunts(data)
      } catch (err) {
        console.error('fetchHunts error:', err)
      } finally {
        setLoading(false)
      }
    }, (err) => {
      console.error('hunts snapshot error:', err)
      setLoading(false)
    })

    return unsub
  }, [user, profile])

  if (loading) return <div className="page" style={{ display:'flex', justifyContent:'center', paddingTop:'4rem' }}><div className="spinner" /></div>

  return (
    <div className="page">
      <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
        <div style={{ fontSize: 52, marginBottom: 8 }}>🗺️</div>
        <h1 style={{ fontSize: 26, fontWeight: 900, marginBottom: 6, color: 'var(--primary)' }}>
          {t('home.welcome', { username: profile?.username })}
        </h1>
        <p style={{ color: 'var(--text2)', fontSize: 15 }}>{t('home.subtitle')}</p>
      </div>

      {hunts.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text2)' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🏴‍☠️</div>
          <p style={{ fontWeight: 800, fontSize: 18, marginBottom: 8, color: 'var(--primary)' }}>{t('home.noHunts')}</p>
          <p style={{ fontSize: 14 }}>
            {profile?.isAdmin ? t('home.noHuntsAdmin') : t('home.noHuntsPlayer')}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {hunts.map((hunt, i) => (
            <HuntCard key={hunt.id} hunt={hunt} emoji={HUNT_EMOJIS[i % HUNT_EMOJIS.length]} onJoin={() => navigate(`/hunt/${hunt.id}`)} />
          ))}
        </div>
      )}
    </div>
  )
}

function HuntCard({ hunt, emoji, onJoin }) {
  const { t } = useTranslation()
  const now = new Date()
  const started = !hunt.startsAt || hunt.startsAt.toDate() <= now
  const ended = hunt.endsAt && hunt.endsAt.toDate() < now
  const clueCount = hunt.clueCount || 0
  const playerCount = (hunt.allowedUsers || []).length
  const isTeams = hunt.mode === 'teams'

  return (
    <div className="card" style={{
      display: 'flex', gap: '1.25rem', alignItems: 'flex-start',
      transition: 'box-shadow 0.2s, transform 0.15s',
      cursor: ended || !started ? 'default' : 'pointer',
      borderTop: `4px solid var(--accent)`,
    }}
      onMouseEnter={e => { if (!ended && started) e.currentTarget.style.boxShadow = 'var(--shadow-hover)' }}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'var(--shadow)'}
      onClick={!ended && started ? onJoin : undefined}
    >
      <div style={{
        fontSize: 44, lineHeight: 1, flexShrink: 0,
        background: 'var(--surface2)', borderRadius: 12, padding: '0.5rem',
        border: '2px solid var(--border)',
      }}>{emoji}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900, color: 'var(--primary)' }}>{hunt.title}</h2>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {isTeams && <span className="badge badge-gold">👥 Teams</span>}
            {ended
              ? <span className="badge badge-gray">{t('home.ended')}</span>
              : started
                ? <span className="badge badge-success">🔴 {t('home.live')}</span>
                : <span className="badge badge-gray">🕐 {t('home.upcoming')}</span>
            }
          </div>
        </div>
        {hunt.description && <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4, lineHeight: 1.5 }}>{hunt.description}</p>}
        <div style={{ display: 'flex', gap: 16, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 700 }}>
            🗝️ {t('home.clues', { count: clueCount })}
          </span>
          <span style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 700 }}>
            👥 {t('home.players', { count: playerCount })}
          </span>
          {hunt.endsAt && (
            <span style={{ fontSize: 13, color: 'var(--text3)', fontWeight: 600 }}>
              ⏱ {t('home.ends', { date: hunt.endsAt.toDate().toLocaleDateString() })}
            </span>
          )}
          <button
            className="btn-primary"
            style={{ marginLeft: 'auto', padding: '0.45rem 1.1rem', fontSize: 14 }}
            onClick={e => { e.stopPropagation(); if (!ended && started) onJoin() }}
            disabled={ended || !started}
          >
            {ended ? t('home.ended') : !started ? t('home.notStarted') : '🏃 ' + t('home.joinHunt')}
          </button>
        </div>
      </div>
    </div>
  )
}
