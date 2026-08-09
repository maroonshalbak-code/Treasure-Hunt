import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { doc, getDoc, collection, getDocs, query, where, orderBy, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import ClueCard from '../components/ClueCard'
import Leaderboard from '../components/Leaderboard'
import Avatar from '../components/Avatar'

const TEAM_COLORS = ['#3498db', '#e74c3c']

export default function Hunt() {
  const { huntId } = useParams()
  const { user } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [hunt, setHunt] = useState(null)
  const [clues, setClues] = useState([])
  const [completedIds, setCompletedIds] = useState(new Set())
  const [pendingIds, setPendingIds] = useState(new Set())
  const [participants, setParticipants] = useState([])
  const [tab, setTab] = useState('clues')
  const [loading, setLoading] = useState(true)
  const [notifications, setNotifications] = useState([])
  const [winner, setWinner] = useState(null) // { name, isTeam }
  const [solvedByMap, setSolvedByMap] = useState({}) // clueId -> { username, playerId }
  const [complexityFilter, setComplexityFilter] = useState(0)   // 0 = all, 1-5
  const [statusFilter, setStatusFilter] = useState('all')        // all | open | pending | completed
  const [typeFilter, setTypeFilter] = useState('all')            // all | text | gps | qr | image

  function pushNotification(type, clueTitle, username) {
    const id = Date.now() + Math.random()
    setNotifications(prev => [...prev, { id, type, clueTitle, username }])
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 5500)
  }

  function playWinSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const fanfare = [
        [523, 0], [523, 0.1], [523, 0.2], [659, 0.35],
        [523, 0.55], [659, 0.65], [784, 0.75],
      ]
      fanfare.forEach(([freq, when]) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.3, ctx.currentTime + when)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + when + 0.3)
        osc.start(ctx.currentTime + when)
        osc.stop(ctx.currentTime + when + 0.3)
      })
    } catch {}
  }

  function dismissNotification(id) {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }

  function playSuccessSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const notes = [523, 659, 784, 1047]
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.12)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.25)
        osc.start(ctx.currentTime + i * 0.12)
        osc.stop(ctx.currentTime + i * 0.12 + 0.25)
      })
    } catch {}
  }

  useEffect(() => {
    let progressUnsub = null

    async function load() {
      const [huntSnap, cluesSnap] = await Promise.all([
        getDoc(doc(db, 'hunts', huntId)),
        getDocs(query(collection(db, 'hunts', huntId, 'clues'), orderBy('displayOrder'))),
      ])

      if (!huntSnap.exists()) { navigate('/'); return }
      const huntData = { id: huntSnap.id, ...huntSnap.data() }
      const allowed = huntData.allowedUsers || []
      if (allowed.length > 0 && !allowed.includes(user.uid)) { navigate('/'); return }

      const cluesData = cluesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      setHunt(huntData)
      setClues(cluesData)

      if (allowed.length > 0) {
        const profileSnaps = await getDocs(query(
          collection(db, 'profiles'),
          where('__name__', 'in', allowed.slice(0, 30))
        ))
        setParticipants(profileSnaps.docs.map(d => ({ id: d.id, ...d.data() })))
      }

      // Real-time listener for ALL players' progress in this hunt
      // A clue is "completed" if any player solved it; "pending" if the current user submitted and awaits review
      let isFirstSnapshot = true
      progressUnsub = onSnapshot(
        query(
          collection(db, 'playerProgress'),
          where('huntId', '==', huntId)
        ),
        (snap) => {
          const completed = new Set()
          const pending = new Set()
          snap.docs.forEach(d => {
            const { clueId, status, playerId } = d.data()
            if (status === 'approved') completed.add(clueId)
            else if (status === 'pending' && playerId === user.uid) pending.add(clueId)
            // rejected: allow current user to resubmit (don't add to either set)
          })
          const solvedBy = {}
          snap.docs.forEach(d => {
            const { clueId, status, playerId, username } = d.data()
            if (status === 'approved' && !solvedBy[clueId]) {
              solvedBy[clueId] = { username, playerId }
            }
          })
          setCompletedIds(completed)
          setPendingIds(pending)
          setSolvedByMap(solvedBy)

          // Check win condition — all clues approved
          if (cluesData.length > 0 && completed.size >= cluesData.length) {
            // Compute winner from approved progress docs
            const byPlayer = {}
            snap.docs.forEach(d => {
              const { playerId, username, points, status } = d.data()
              if (status !== 'approved') return
              if (!byPlayer[playerId]) byPlayer[playerId] = { username, points: 0 }
              byPlayer[playerId].points += points || 0
            })
            const sorted = Object.values(byPlayer).sort((a, b) => b.points - a.points)
            const isTeams = huntData.mode === 'teams'
            if (isTeams && huntData.teamNames && huntData.teamAssignments) {
              const teamTotals = {}
              sorted.forEach(p => {
                const tid = huntData.teamAssignments[Object.keys(byPlayer).find(k => byPlayer[k] === p)]
                if (tid !== undefined) {
                  const name = huntData.teamNames[tid] || `Team ${tid + 1}`
                  teamTotals[name] = (teamTotals[name] || 0) + p.points
                }
              })
              const topTeam = Object.entries(teamTotals).sort((a, b) => b[1] - a[1])[0]
              setWinner({ name: topTeam?.[0] || 'The team', isTeam: true })
            } else {
              setWinner({ name: sorted[0]?.username || 'A player', isTeam: false })
            }
            playWinSound()
          }

          // Skip notifications on the initial load snapshot
          if (!isFirstSnapshot) {
            snap.docChanges().forEach(change => {
              const { status, clueId, username } = change.doc.data()
              // 'added' = new instant-approved clue (text/gps/qr); 'modified' = photo approved by admin
              if ((change.type === 'added' || change.type === 'modified') && status === 'approved') {
                const clue = cluesData.find(c => c.id === clueId)
                pushNotification('approved', clue?.title || 'Clue', username)
                playSuccessSound()
              }
              if (change.type === 'modified' && status === 'rejected') {
                const clue = cluesData.find(c => c.id === clueId)
                pushNotification('rejected', clue?.title || 'Clue', username)
              }
            })
          }
          isFirstSnapshot = false
          setLoading(false)
        }
      )
    }

    load()
    return () => { if (progressUnsub) progressUnsub() }
  }, [huntId])

  function handleComplete(clueId) {
    setCompletedIds(prev => new Set([...prev, clueId]))
  }

  if (loading) return (
    <div className="page" style={{ display: 'flex', justifyContent: 'center', paddingTop: '4rem' }}>
      <div className="spinner" />
    </div>
  )

  const found = completedIds.size
  const total = clues.length
  const pct = total > 0 ? Math.round((found / total) * 100) : 0

  const teamAssignments = hunt?.teamAssignments || {}
  const teamNames = hunt?.teamNames || ['Team A', 'Team B']
  const isTeams = hunt?.mode === 'teams'

  const participantsByTeam = isTeams ? {
    0: participants.filter(p => teamAssignments[p.id] === 0),
    1: participants.filter(p => teamAssignments[p.id] === 1),
    unassigned: participants.filter(p => teamAssignments[p.id] === undefined),
  } : null

  return (
    <div className="page-wide" style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: '1.5rem', alignItems: 'start' }}>
      <div>

        <div style={{ marginBottom: '1.5rem' }}>
          <button className="btn-ghost" style={{ fontSize: 12, marginBottom: 12 }} onClick={() => navigate('/')}>
            {t('hunt.back')}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 20, fontWeight: 900, color: 'var(--primary)' }}>{hunt.title}</h1>
            {isTeams && <span className="badge badge-gold">👥 {t('hunt.teamsLabel')}</span>}
          </div>
          {hunt.description && <p style={{ color: 'var(--text2)', fontSize: 14 }}>{hunt.description}</p>}
          <div style={{ marginTop: 14, background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '0.75rem 1rem', border: '2px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
              <span style={{ color: 'var(--text2)', fontWeight: 600 }}>{t('hunt.progress')}</span>
              <span style={{ fontWeight: 800 }}>{t('hunt.cluesProgress', { found, total, pct })}</span>
            </div>
            <div className="progress-bar-wrap">
              <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            {pendingIds.size > 0 && (
              <p style={{ marginTop: 8, fontSize: 12, color: 'var(--warning)', fontWeight: 700 }}>
                {t('hunt.pendingPhotos', { count: pendingIds.size })}
              </p>
            )}
            {found === total && total > 0 && (
              <p style={{ marginTop: 8, fontSize: 13, color: 'var(--success)', fontWeight: 800 }}>
                {t('hunt.allFound')}
              </p>
            )}
          </div>
        </div>

        <div className="tab-bar">
          <button className={`tab ${tab === 'clues' ? 'active' : ''}`} onClick={() => setTab('clues')}>
            {t('hunt.cluesTab', { count: total })}
          </button>
          <button className={`tab ${tab === 'leaderboard' ? 'active' : ''}`} onClick={() => setTab('leaderboard')}>
            {t('hunt.leaderboard')}
          </button>
        </div>

        {tab === 'clues' && (
          <div>
            {/* Filter bar */}
            <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Status filters */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginRight: 2 }}>{t('hunt.filterStatus')}</span>
                {[
                  { key: 'all', label: t('hunt.filterAll') },
                  { key: 'open', label: `○ ${t('hunt.filterOpen')}` },
                  { key: 'pending', label: `⏳ ${t('hunt.filterPending')}` },
                  { key: 'completed', label: `✅ ${t('hunt.filterDone')}` },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setStatusFilter(key)}
                    style={{
                      fontSize: 12, padding: '4px 12px', borderRadius: 99,
                      fontWeight: 700, cursor: 'pointer',
                      background: statusFilter === key ? 'var(--primary)' : 'var(--surface)',
                      color: statusFilter === key ? '#fff' : 'var(--text2)',
                      border: statusFilter === key ? '2px solid var(--primary)' : '2px solid var(--border)',
                      transition: 'all 0.15s',
                    }}
                  >{label}</button>
                ))}
              </div>

              {/* Type filters */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginRight: 2 }}>{t('hunt.filterType')}</span>
                {[
                  { key: 'all', label: t('hunt.filterAll') },
                  { key: 'text', label: `💬 ${t('clue.riddle')}` },
                  { key: 'gps', label: `📍 ${t('clue.gps')}` },
                  { key: 'qr', label: `📷 ${t('clue.qr')}` },
                  { key: 'image', label: `🖼️ ${t('clue.image').replace('📸 ', '')}` },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setTypeFilter(key)}
                    style={{
                      fontSize: 12, padding: '4px 12px', borderRadius: 99,
                      fontWeight: 700, cursor: 'pointer',
                      background: typeFilter === key ? 'var(--primary)' : 'var(--surface)',
                      color: typeFilter === key ? '#fff' : 'var(--text2)',
                      border: typeFilter === key ? '2px solid var(--primary)' : '2px solid var(--border)',
                      transition: 'all 0.15s',
                    }}
                  >{label}</button>
                ))}
              </div>

              {/* Complexity filters */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginRight: 2 }}>{t('hunt.filterLevel')}</span>
                <button
                  onClick={() => setComplexityFilter(0)}
                  style={{
                    fontSize: 12, padding: '4px 12px', borderRadius: 99,
                    fontWeight: 700, cursor: 'pointer',
                    background: complexityFilter === 0 ? 'var(--primary)' : 'var(--surface)',
                    color: complexityFilter === 0 ? '#fff' : 'var(--text2)',
                    border: complexityFilter === 0 ? '2px solid var(--primary)' : '2px solid var(--border)',
                    transition: 'all 0.15s',
                  }}
                >{t('hunt.filterAll')}</button>
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    onClick={() => setComplexityFilter(n)}
                    style={{
                      fontSize: 13, padding: '4px 10px', borderRadius: 99,
                      fontWeight: 700, cursor: 'pointer',
                      background: complexityFilter === n ? 'var(--primary)' : 'var(--surface)',
                      color: complexityFilter === n ? '#fff' : 'var(--text2)',
                      border: complexityFilter === n ? '2px solid var(--primary)' : '2px solid var(--border)',
                      transition: 'all 0.15s',
                    }}
                  >{'⭐'.repeat(n)}</button>
                ))}
              </div>
            </div>

            {/* Clue grid */}
            {clues.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text3)', padding: '3rem' }}>
                {t('hunt.noClues')}
              </div>
            ) : (() => {
              const sorted = [
                ...clues.filter(c => !completedIds.has(c.id) && !pendingIds.has(c.id)),
                ...clues.filter(c => pendingIds.has(c.id)),
                ...clues.filter(c => completedIds.has(c.id)),
              ]
              const filtered = sorted.filter(c => {
                if (complexityFilter !== 0 && (c.difficulty || 1) !== complexityFilter) return false
                if (typeFilter !== 'all' && c.clueType !== typeFilter) return false
                if (statusFilter === 'open' && (completedIds.has(c.id) || pendingIds.has(c.id))) return false
                if (statusFilter === 'pending' && !pendingIds.has(c.id)) return false
                if (statusFilter === 'completed' && !completedIds.has(c.id)) return false
                return true
              })
              if (filtered.length === 0) return (
                <div style={{ textAlign: 'center', color: 'var(--text3)', padding: '2rem', fontSize: 14 }}>
                  {t('hunt.noFilterResults')}
                </div>
              )
              return (
                <div className="clue-grid">
                  {filtered.map(clue => (
                    <ClueCard
                      key={clue.id}
                      clue={{ ...clue, huntId }}
                      completed={completedIds.has(clue.id)}
                      pending={pendingIds.has(clue.id)}
                      solvedBy={solvedByMap[clue.id] || null}
                      onComplete={handleComplete}
                    />
                  ))}
                </div>
              )
            })()}
          </div>
        )}

        {tab === 'leaderboard' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
              <h2 style={{ fontSize: 15, fontWeight: 800, color: 'var(--primary)' }}>{t('hunt.liveLeaderboard')}</h2>
              <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{t('hunt.liveSubtitle')}</p>
            </div>
            <Leaderboard huntId={huntId} totalClues={total} hunt={hunt} clues={clues} />
          </div>
        )}
      </div>

      {/* Participants sidebar */}
      <div className="card" style={{ position: 'sticky', top: '1rem' }}>
        <h2 style={{ fontSize: 14, fontWeight: 800, marginBottom: 12, color: 'var(--primary)' }}>
          {t('hunt.players')} <span style={{ color: 'var(--text3)', fontWeight: 600 }}>({participants.length})</span>
        </h2>
        {participants.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text3)' }}>–</p>
        ) : isTeams ? (
          <div>
            {[0, 1].map(teamIdx => {
              const members = participantsByTeam[teamIdx]
              if (members.length === 0) return null
              return (
                <div key={teamIdx} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: TEAM_COLORS[teamIdx], flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 800, color: TEAM_COLORS[teamIdx] }}>{teamNames[teamIdx]}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 14 }}>
                    {members.map(p => (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Avatar username={p.username} photoUrl={p.photoUrl} size={28} />
                        <span style={{ fontSize: 12, fontWeight: p.id === user.uid ? 800 : 500 }}>
                          {p.username}{p.id === user.uid ? ' (you)' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
            {participantsByTeam.unassigned.length > 0 && (
              <div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6, fontWeight: 600 }}>{t('hunt.unassigned')}</div>
                {participantsByTeam.unassigned.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <Avatar username={p.username} photoUrl={p.photoUrl} size={28} />
                    <span style={{ fontSize: 12 }}>{p.username}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {participants.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar username={p.username} photoUrl={p.photoUrl} size={36} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: p.id === user.uid ? 800 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.username}{p.id === user.uid ? ` ${t('hunt.you')}` : ''}
                  </div>
                  {p.isAdmin && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{t('hunt.admin')}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Win modal */}
      {winner && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 10000, padding: '1.5rem',
        }}>
          <div style={{
            background: 'var(--surface)', borderRadius: 20, padding: '2.5rem 2rem',
            textAlign: 'center', maxWidth: 360, width: '100%',
            border: '3px solid var(--accent)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            animation: 'toastIn 0.4s cubic-bezier(0.34,1.56,0.64,1)',
          }}>
            <div style={{ fontSize: 72, marginBottom: 12 }}>🏆</div>
            <h2 style={{ fontSize: 26, fontWeight: 900, color: 'var(--primary)', marginBottom: 8 }}>
              {winner.isTeam ? '🎉 Team wins!' : '🎉 We have a winner!'}
            </h2>
            <div style={{
              fontSize: 28, fontWeight: 900, color: 'var(--accent)',
              marginBottom: 8, padding: '0.5rem 1rem',
              background: 'var(--surface2)', borderRadius: 12,
            }}>
              {winner.isTeam ? '👥' : '🥇'} {winner.name}
            </div>
            <p style={{ color: 'var(--text2)', fontSize: 14, marginBottom: 24 }}>
              {winner.isTeam
                ? `${winner.name} completed all clues first!`
                : `${winner.name} completed all clues first!`}
            </p>
            <button className="btn-primary" style={{ width: '100%', fontSize: 16, padding: '0.75rem' }}
              onClick={() => setWinner(null)}>
              🗺️ View results
            </button>
          </div>
        </div>
      )}

      {/* Toast notifications */}
      <div style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', display: 'flex', flexDirection: 'column', gap: 10, zIndex: 9999, pointerEvents: 'none' }}>
        {notifications.map(notif => (
          <div key={notif.id} style={{
            pointerEvents: 'all',
            background: notif.type === 'approved' ? '#dcfce7' : '#fee2e2',
            border: `2px solid ${notif.type === 'approved' ? '#86efac' : '#fca5a5'}`,
            color: notif.type === 'approved' ? '#15803d' : '#dc2626',
            borderRadius: 14,
            padding: '0.875rem 1rem',
            fontSize: 14,
            fontWeight: 700,
            boxShadow: '0 6px 24px rgba(0,0,0,0.15)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            minWidth: 270,
            maxWidth: 340,
            animation: 'toastIn 0.3s cubic-bezier(0.34,1.56,0.64,1)',
          }}>
            <span style={{ fontSize: 26, flexShrink: 0 }}>
              {notif.type === 'approved' ? '🎉' : '😞'}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>
                {notif.type === 'approved'
                  ? (notif.username ? `${notif.username} found a clue!` : t('hunt.clueApproved'))
                  : t('hunt.clueRejected')}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.75, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {notif.clueTitle}
              </div>
            </div>
            <button onClick={() => dismissNotification(notif.id)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 16, padding: '2px 4px', color: 'inherit', opacity: 0.6, flexShrink: 0,
            }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}
