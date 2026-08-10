import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore'
import { db } from '../lib/firebase'
import Avatar from './Avatar'

const MEDALS = ['🥇', '🥈', '🥉']
const TEAM_COLORS = ['#3498db', '#e74c3c']

export default function Leaderboard({ huntId, totalClues, hunt, clues = [] }) {
  const { t } = useTranslation()
  const [rows, setRows] = useState([])
  const [profiles, setProfiles] = useState({})
  const [loading, setLoading] = useState(true)
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [selectedClue, setSelectedClue] = useState(null)

  const isTeams = hunt?.mode === 'teams'
  const teamNames = hunt?.teamNames || ['Team A', 'Team B']
  const teamAssignments = hunt?.teamAssignments || {}

  useEffect(() => {
    const q = query(collection(db, 'playerProgress'), where('huntId', '==', huntId))
    const unsub = onSnapshot(q, async (snap) => {
      const byPlayer = {}
      snap.docs.forEach(d => {
        const { playerId, username, points, completedAt, status, clueId, clueTitle } = d.data()
        // Only count approved or legacy (no status) entries toward score
        if (status === 'pending' || status === 'rejected') return
        if (!byPlayer[playerId]) {
          byPlayer[playerId] = { playerId, username, cluesFound: 0, totalPoints: 0, lastFoundAt: null, solvedClues: [], seenClueIds: new Set() }
        }
        // Deduplicate — only count each clue once per player
        if (byPlayer[playerId].seenClueIds.has(clueId)) return
        byPlayer[playerId].seenClueIds.add(clueId)
        byPlayer[playerId].cluesFound += 1
        byPlayer[playerId].totalPoints += points || 0
        const resolvedTitle = clueTitle || clues.find(c => c.id === clueId)?.title || clueId
        byPlayer[playerId].solvedClues.push({ clueId, clueTitle: resolvedTitle })
        const ts = completedAt?.toDate?.() ?? null
        if (ts && (!byPlayer[playerId].lastFoundAt || ts > byPlayer[playerId].lastFoundAt)) {
          byPlayer[playerId].lastFoundAt = ts
        }
      })

      const sorted = Object.values(byPlayer).sort((a, b) => {
        if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints
        return (a.lastFoundAt || 0) - (b.lastFoundAt || 0)
      })
      setRows(sorted)

      const uids = Object.keys(byPlayer)
      if (uids.length > 0) {
        const profileSnap = await getDocs(query(
          collection(db, 'profiles'),
          where('__name__', 'in', uids.slice(0, 30))
        ))
        const map = {}
        profileSnap.docs.forEach(d => { map[d.id] = d.data() })
        setProfiles(map)
      }

      setLoading(false)
    })
    return unsub
  }, [huntId])

  if (loading) return <div style={{ display:'flex', justifyContent:'center', padding:'1rem' }}><div className="spinner" /></div>
  if (rows.length === 0) return (
    <div style={{ textAlign:'center', color:'var(--text3)', padding:'2rem', fontSize:14 }}>
      {t('leaderboard.empty')}
    </div>
  )

  if (isTeams) {
    // Aggregate by team
    const teamTotals = [
      { name: teamNames[0], color: TEAM_COLORS[0], members: rows.filter(r => teamAssignments[r.playerId] === 0) },
      { name: teamNames[1], color: TEAM_COLORS[1], members: rows.filter(r => teamAssignments[r.playerId] === 1) },
    ]
    teamTotals.forEach(t => {
      t.totalPoints = t.members.reduce((sum, m) => sum + m.totalPoints, 0)
      t.cluesFound = t.members.reduce((sum, m) => sum + m.cluesFound, 0)
    })
    const sorted = [...teamTotals].sort((a, b) => b.totalPoints - a.totalPoints)

    return (
      <div>
      {selectedPlayer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={() => { setSelectedPlayer(null); setSelectedClue(null) }}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', padding: '1.5rem', minWidth: 280, maxWidth: 400, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              {selectedClue ? (
                <button onClick={() => setSelectedClue(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--primary)', fontWeight: 700, padding: 0 }}>
                  ← {selectedPlayer.username}'s clues
                </button>
              ) : (
                <span style={{ fontWeight: 800, fontSize: 16 }}>{selectedPlayer.username}'s clues</span>
              )}
              <button onClick={() => { setSelectedPlayer(null); setSelectedClue(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text3)' }}>✕</button>
            </div>
            {selectedClue ? (
              <div>
                <h3 style={{ fontWeight: 800, fontSize: 16, color: 'var(--primary)', marginBottom: 8 }}>{selectedClue.title}</h3>
                {selectedClue.clueType && (
                  <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--surface2)', color: 'var(--text2)', marginBottom: 10, display: 'inline-block' }}>
                    {{ text: '💬', gps: '📍', qr: '📷', image: '🖼️', date: '📅', puzzle: '🧩' }[selectedClue.clueType] || '❓'} {selectedClue.clueType}
                  </span>
                )}
                <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.7, marginTop: 10 }}>{selectedClue.riddle}</p>
                {(selectedClue.clueType === 'image' || selectedClue.clueType === 'puzzle') && selectedClue.imageUrl && (
                  <img src={selectedClue.imageUrl} alt="clue" style={{ width: '100%', borderRadius: 8, marginTop: 10, objectFit: 'contain', background: 'var(--surface2)' }} />
                )}
                {selectedClue.clueType === 'gps' && selectedClue.lat && (
                  <p style={{ fontSize: 13, color: 'var(--text3)', marginTop: 8 }}>📍 {selectedClue.lat}, {selectedClue.lng} (±{selectedClue.gpsRadiusMeters}m)</p>
                )}
              </div>
            ) : selectedPlayer.solvedClues.length === 0 ? (
              <p style={{ color: 'var(--text3)', fontSize: 14 }}>No clues solved yet.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {selectedPlayer.solvedClues.map((sc, i) => {
                  const fullClue = clues.find(c => c.id === sc.clueId)
                  return (
                    <li key={i}
                      onClick={() => fullClue && setSelectedClue(fullClue)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0.75rem', background: 'var(--surface2)', borderRadius: 'var(--radius)', fontSize: 14, cursor: fullClue ? 'pointer' : 'default', transition: 'background 0.15s' }}
                      onMouseEnter={e => { if (fullClue) e.currentTarget.style.background = 'var(--border)' }}
                      onMouseLeave={e => e.currentTarget.style.background = 'var(--surface2)'}
                    >
                      <span style={{ color: '#22c55e', fontWeight: 700 }}>✓</span>
                      <span style={{ flex: 1 }}>{sc.clueTitle}</span>
                      {fullClue && <span style={{ color: 'var(--text3)', fontSize: 12 }}>›</span>}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
        {/* Team banners */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
          {sorted.map((team, i) => (
            <div key={team.name} style={{
              flex: 1, padding: '0.875rem 1rem', textAlign: 'center',
              background: i === 0 ? team.color + '15' : 'transparent',
              borderRight: i === 0 ? '1px solid var(--border)' : 'none',
            }}>
              <div style={{ fontSize: 18, marginBottom: 2 }}>{i === 0 ? '🏆' : '🥈'}</div>
              <div style={{ fontWeight: 700, fontSize: 15, color: team.color }}>{team.name}</div>
              <div style={{ fontWeight: 700, fontSize: 20, color: team.color }}>{team.totalPoints} {t('leaderboard.pts')}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{team.cluesFound} {t('leaderboard.cluesFound')}</div>
            </div>
          ))}
        </div>

        {/* Individual rows within each team */}
        {sorted.map(team => (
          <div key={team.name}>
            <div style={{ padding: '0.6rem 1.25rem', background: team.color + '10', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: team.color }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: team.color }}>{team.name}</span>
            </div>
            {team.members.length === 0 ? (
              <div style={{ padding: '0.75rem 1.25rem', fontSize: 13, color: 'var(--text3)' }}>{t('leaderboard.noMembers')}</div>
            ) : (
              team.members.map((row, i) => {
                const pct = totalClues > 0 ? Math.round((row.cluesFound / totalClues) * 100) : 0
                const profile = profiles[row.playerId]
                return (
                  <div key={row.playerId} className="leaderboard-row" style={{ cursor: 'pointer' }} onClick={() => setSelectedPlayer(row)}>
                    <div className="rank" style={{ color: team.color }}>#{i + 1}</div>
                    <Avatar username={row.username} photoUrl={profile?.photoUrl} size={32} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
                        <span style={{ fontWeight: 500, fontSize: 13 }}>{row.username}</span>
                        <span style={{ fontSize: 12, color:'var(--text2)', flexShrink: 0 }}>
                          {row.cluesFound}/{totalClues} · <span style={{ color: team.color, fontWeight:600 }}>{row.totalPoints} {t('leaderboard.pts')}</span>
                        </span>
                      </div>
                      <div className="progress-bar-wrap" style={{ marginTop: 4 }}>
                        <div className="progress-bar-fill" style={{ width: `${pct}%`, background: team.color }} />
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        ))}

        {/* Unassigned players */}
        {rows.filter(r => teamAssignments[r.playerId] === undefined).map((row, i) => {
          const pct = totalClues > 0 ? Math.round((row.cluesFound / totalClues) * 100) : 0
          const profile = profiles[row.playerId]
          return (
            <div key={row.playerId} className="leaderboard-row" style={{ opacity: 0.6, cursor: 'pointer' }} onClick={() => setSelectedPlayer(row)}>
              <div className="rank">#{i + 1}</div>
              <Avatar username={row.username} photoUrl={profile?.photoUrl} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
                  <span style={{ fontWeight: 500, fontSize: 13 }}>{row.username}</span>
                  <span style={{ fontSize: 12, color:'var(--text2)' }}>{row.totalPoints} {t('leaderboard.pts')}</span>
                </div>
                <div className="progress-bar-wrap" style={{ marginTop: 4 }}>
                  <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // Individual mode leaderboard
  return (
    <div>
      {selectedPlayer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={() => { setSelectedPlayer(null); setSelectedClue(null) }}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', padding: '1.5rem', minWidth: 280, maxWidth: 400, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              {selectedClue ? (
                <button onClick={() => setSelectedClue(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--primary)', fontWeight: 700, padding: 0 }}>
                  ← {selectedPlayer.username}'s clues
                </button>
              ) : (
                <span style={{ fontWeight: 800, fontSize: 16 }}>{selectedPlayer.username}'s clues</span>
              )}
              <button onClick={() => { setSelectedPlayer(null); setSelectedClue(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text3)' }}>✕</button>
            </div>
            {selectedClue ? (
              <div>
                <h3 style={{ fontWeight: 800, fontSize: 16, color: 'var(--primary)', marginBottom: 8 }}>{selectedClue.title}</h3>
                {selectedClue.clueType && (
                  <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--surface2)', color: 'var(--text2)', marginBottom: 10, display: 'inline-block' }}>
                    {{ text: '💬', gps: '📍', qr: '📷', image: '🖼️', date: '📅', puzzle: '🧩' }[selectedClue.clueType] || '❓'} {selectedClue.clueType}
                  </span>
                )}
                <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.7, marginTop: 10 }}>{selectedClue.riddle}</p>
                {(selectedClue.clueType === 'image' || selectedClue.clueType === 'puzzle') && selectedClue.imageUrl && (
                  <img src={selectedClue.imageUrl} alt="clue" style={{ width: '100%', borderRadius: 8, marginTop: 10, objectFit: 'contain', background: 'var(--surface2)' }} />
                )}
                {selectedClue.clueType === 'gps' && selectedClue.lat && (
                  <p style={{ fontSize: 13, color: 'var(--text3)', marginTop: 8 }}>📍 {selectedClue.lat}, {selectedClue.lng} (±{selectedClue.gpsRadiusMeters}m)</p>
                )}
              </div>
            ) : selectedPlayer.solvedClues.length === 0 ? (
              <p style={{ color: 'var(--text3)', fontSize: 14 }}>No clues solved yet.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {selectedPlayer.solvedClues.map((sc, i) => {
                  const fullClue = clues.find(c => c.id === sc.clueId)
                  return (
                    <li key={i}
                      onClick={() => fullClue && setSelectedClue(fullClue)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0.75rem', background: 'var(--surface2)', borderRadius: 'var(--radius)', fontSize: 14, cursor: fullClue ? 'pointer' : 'default', transition: 'background 0.15s' }}
                      onMouseEnter={e => { if (fullClue) e.currentTarget.style.background = 'var(--border)' }}
                      onMouseLeave={e => e.currentTarget.style.background = 'var(--surface2)'}
                    >
                      <span style={{ color: '#22c55e', fontWeight: 700 }}>✓</span>
                      <span style={{ flex: 1 }}>{sc.clueTitle}</span>
                      {fullClue && <span style={{ color: 'var(--text3)', fontSize: 12 }}>›</span>}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {rows.map((row, i) => {
        const pct = totalClues > 0 ? Math.round((row.cluesFound / totalClues) * 100) : 0
        const profile = profiles[row.playerId]
        return (
          <div key={row.playerId} className="leaderboard-row" style={{ cursor: 'pointer' }} onClick={() => setSelectedPlayer(row)}>
            <div className={`rank ${i < 3 ? 'top' : ''}`}>{i < 3 ? MEDALS[i] : `#${i + 1}`}</div>
            <Avatar username={row.username} photoUrl={profile?.photoUrl} size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
                <span style={{ fontWeight: 500, fontSize: 14 }}>{row.username}</span>
                <span style={{ fontSize: 13, color:'var(--text2)', flexShrink: 0 }}>
                  {row.cluesFound}/{totalClues} · <span style={{ color:'var(--accent)', fontWeight:600 }}>{row.totalPoints} {t('leaderboard.pts')}</span>
                </span>
              </div>
              <div className="progress-bar-wrap" style={{ marginTop: 4 }}>
                <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
