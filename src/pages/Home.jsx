import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { collection, query, getDocs, orderBy, onSnapshot, where } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

async function computeHuntCompletion(hunt, clueCount) {
  if (clueCount === 0) return null
  const snap = await getDocs(query(
    collection(db, 'playerProgress'),
    where('huntId', '==', hunt.id),
    where('status', '==', 'approved')
  ))
  // Deduplicate clues — count unique clueIds
  const uniqueClues = new Set(snap.docs.map(d => d.data().clueId))
  if (uniqueClues.size < clueCount) return null // not yet complete

  // Find last completion time
  let lastTs = null
  snap.docs.forEach(d => {
    const ts = d.data().completedAt?.toDate?.()
    if (ts && (!lastTs || ts > lastTs)) lastTs = ts
  })

  // Compute winner — by points
  const byPlayer = {}
  snap.docs.forEach(d => {
    const { playerId, username, points } = d.data()
    if (!byPlayer[playerId]) byPlayer[playerId] = { username, points: 0 }
    byPlayer[playerId].points += points || 0
  })

  let winnerName = null
  const isTeams = hunt.mode === 'teams'
  if (isTeams && hunt.teamNames && hunt.teamAssignments) {
    const teamTotals = {}
    Object.entries(byPlayer).forEach(([uid, p]) => {
      const tid = hunt.teamAssignments[uid]
      if (tid !== undefined) {
        const name = hunt.teamNames[tid] || `Team ${tid + 1}`
        teamTotals[name] = (teamTotals[name] || 0) + p.points
      }
    })
    const top = Object.entries(teamTotals).sort((a, b) => b[1] - a[1])[0]
    winnerName = top?.[0] || null
  } else {
    const top = Object.values(byPlayer).sort((a, b) => b.points - a.points)[0]
    winnerName = top?.username || null
  }

  // Duration: last clue solved minus hunt start
  const startTime = hunt.startsAt?.toDate?.() || hunt.createdAt?.toDate?.() || null
  const duration = (startTime && lastTs) ? formatDuration(lastTs - startTime) : null

  return { winnerName, duration, completedAt: lastTs }
}

const HUNT_EMOJIS = ['🏆', '💎', '🗝️', '🌟', '🔮', '🎯', '🚀', '🐉']

export default function Home() {
  const { profile, user } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [hunts, setHunts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user || profile === undefined) return

    // Fetch all hunts, filter/sort on client — avoids composite index requirement
    const q = query(collection(db, 'hunts'), orderBy('createdAt', 'desc'))

    const unsub = onSnapshot(q, async (snap) => {
      try {
        let data = await Promise.all(snap.docs.map(async d => {
          const cluesSnap = await getDocs(collection(db, 'hunts', d.id, 'clues'))
          const hunt = { id: d.id, ...d.data(), clueCount: cluesSnap.size }
          const completion = await computeHuntCompletion(hunt, cluesSnap.size)
          return { ...hunt, completion }
        }))
        // Filter active hunts; players also filtered to their assigned hunts
        data = data.filter(h => h.isActive)
        if (!profile?.isAdmin) {
          data = data.filter(h => (h.allowedUsers || []).includes(user.uid))
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
  const completed = !!hunt.completion
  const clueCount = hunt.clueCount || 0
  const playerCount = (hunt.allowedUsers || []).length
  const isTeams = hunt.mode === 'teams'
  const isClickable = !ended && started && !completed

  return (
    <div className="card" style={{
      display: 'flex', gap: '1.25rem', alignItems: 'flex-start',
      transition: 'box-shadow 0.2s, transform 0.15s',
      cursor: isClickable ? 'pointer' : 'default',
      borderTop: `4px solid ${completed ? '#22c55e' : 'var(--accent)'}`,
    }}
      onMouseEnter={e => { if (isClickable) e.currentTarget.style.boxShadow = 'var(--shadow-hover)' }}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'var(--shadow)'}
      onClick={isClickable ? onJoin : undefined}
    >
      <div style={{
        fontSize: 44, lineHeight: 1, flexShrink: 0,
        background: 'var(--surface2)', borderRadius: 12, padding: '0.5rem',
        border: '2px solid var(--border)',
      }}>{completed ? '🏆' : emoji}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900, color: 'var(--primary)' }}>{hunt.title}</h2>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {isTeams && <span className="badge badge-gold">👥 Teams</span>}
            {completed
              ? <span className="badge badge-success">✅ Completed</span>
              : ended
                ? <span className="badge badge-gray">{t('home.ended')}</span>
                : started
                  ? <span className="badge badge-success">🔴 {t('home.live')}</span>
                  : <span className="badge badge-gray">🕐 {t('home.upcoming')}</span>
            }
          </div>
        </div>
        {hunt.description && <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4, lineHeight: 1.5 }}>{hunt.description}</p>}

        {completed && hunt.completion && (
          <div style={{ marginTop: 8, padding: '0.5rem 0.75rem', background: 'rgba(34,197,94,0.08)', borderRadius: 'var(--radius)', border: '1px solid rgba(34,197,94,0.2)' }}>
            {hunt.completion.winnerName && (
              <div style={{ fontSize: 13, fontWeight: 700, color: '#22c55e', marginBottom: 2 }}>
                🥇 Winner: {hunt.completion.winnerName}
              </div>
            )}
            {hunt.completion.duration && (
              <div style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 600 }}>
                ⏱ Completed in {hunt.completion.duration}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 16, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 700 }}>
            🗝️ {t('home.clues', { count: clueCount })}
          </span>
          <span style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 700 }}>
            👥 {t('home.players', { count: playerCount })}
          </span>
          {!completed && hunt.endsAt && (
            <span style={{ fontSize: 13, color: 'var(--text3)', fontWeight: 600 }}>
              ⏱ {t('home.ends', { date: hunt.endsAt.toDate().toLocaleDateString() })}
            </span>
          )}
          {!completed && (
            <button
              className="btn-primary"
              style={{ marginLeft: 'auto', padding: '0.45rem 1.1rem', fontSize: 14 }}
              onClick={e => { e.stopPropagation(); if (isClickable) onJoin() }}
              disabled={ended || !started}
            >
              {ended ? t('home.ended') : !started ? t('home.notStarted') : '🏃 ' + t('home.joinHunt')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
