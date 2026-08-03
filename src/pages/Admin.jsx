import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  collection, addDoc, getDocs, doc, updateDoc, deleteDoc, setDoc,
  query, orderBy, serverTimestamp, arrayUnion, arrayRemove, where, Timestamp
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import QRCode from 'qrcode'


const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET
const CLOUDINARY_API_KEY = import.meta.env.VITE_CLOUDINARY_API_KEY
const CLOUDINARY_API_SECRET = import.meta.env.VITE_CLOUDINARY_API_SECRET

// Extract Cloudinary public_id from a URL
function extractPublicId(url) {
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/)
  return match ? match[1] : null
}

// Generate SHA-1 signature for signed Cloudinary API calls
async function generateCloudinarySignature(publicId, timestamp) {
  const str = `public_id=${publicId}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`
  const data = new TextEncoder().encode(str)
  const hashBuffer = await crypto.subtle.digest('SHA-1', data)
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Delete a single image from Cloudinary by its URL
async function destroyCloudinaryImage(url) {
  const publicId = extractPublicId(url)
  if (!publicId) throw new Error('Could not extract public_id from URL')
  const timestamp = Math.round(Date.now() / 1000)
  const signature = await generateCloudinarySignature(publicId, timestamp)
  const form = new FormData()
  form.append('public_id', publicId)
  form.append('signature', signature)
  form.append('api_key', CLOUDINARY_API_KEY)
  form.append('timestamp', timestamp)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/destroy`, { method: 'POST', body: form })
  const data = await res.json()
  if (data.result !== 'ok' && data.result !== 'not found') throw new Error(data.result || 'Cloudinary error')
}

const CLUE_TYPES = ['text', 'gps', 'qr', 'image', 'date']
const CLUE_TYPE_ICONS = { text: '💬', gps: '📍', qr: '📷', image: '🖼️', date: '📅' }
const TEAM_COLORS = ['#3498db', '#e74c3c']
const DIFFICULTY_LABELS = { 1: '⭐ Easy', 2: '⭐⭐ Medium', 3: '⭐⭐⭐ Hard', 4: '⭐⭐⭐⭐ Very Hard', 5: '⭐⭐⭐⭐⭐ Expert' }
const DIFFICULTY_COLORS = { 1: '#15803d', 2: '#1d4ed8', 3: '#b45309', 4: '#c2410c', 5: '#7e22ce' }
const DIFFICULTY_BG = { 1: '#dcfce7', 2: '#dbeafe', 3: '#fef3c7', 4: '#ffedd5', 5: '#fae8ff' }
const DIFFICULTY_POINTS = { 1: 10, 2: 20, 3: 30, 4: 40, 5: 50 }

export default function Admin() {
  const { profile, user } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()

  useEffect(() => { if (profile && !profile.isAdmin) navigate('/') }, [profile])

  const [tab, setTab] = useState('hunts')
  const [hunts, setHunts] = useState([])
  const [selectedHunt, setSelectedHunt] = useState(null)
  const [clues, setClues] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [reviews, setReviews] = useState([])
  const [huntImages, setHuntImages] = useState([])
  const [deletingImageId, setDeletingImageId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [qrToken, setQrToken] = useState(null)
  const [clueImageUrl, setClueImageUrl] = useState(null)
  const [uploadingClueImg, setUploadingClueImg] = useState(false)
  const [showCreatePlayer, setShowCreatePlayer] = useState(false)
  const [creatingPlayer, setCreatingPlayer] = useState(false)
  const [generatingLink, setGeneratingLink] = useState(false)
  const [showPlayerPassword, setShowPlayerPassword] = useState(false)
  const [newPlayer, setNewPlayer] = useState({ username: '', email: '', password: '' })
  const clueImgRef = useRef()

  const [newHunt, setNewHunt] = useState({
    title: '', description: '', startsAt: '', endsAt: '',
    mode: 'individual', teamAName: 'Team A', teamBName: 'Team B'
  })
  const [newClue, setNewClue] = useState({
    title: '', riddle: '', clueType: 'text', answers: [''],
    lat: '', lng: '', gpsRadiusMeters: 50, difficulty: 1,
    targetDate: '', dateTolerance: 0
  })

  useEffect(() => { fetchHunts() }, [])

  async function fetchHunts() {
    const snap = await getDocs(query(collection(db, 'hunts'), orderBy('createdAt', 'desc')))
    const data = await Promise.all(snap.docs.map(async d => {
      const clueSnap = await getDocs(collection(db, 'hunts', d.id, 'clues'))
      return { id: d.id, ...d.data(), clueCount: clueSnap.size }
    }))
    setHunts(data); setLoading(false)
  }

  async function fetchClues(huntId) {
    const snap = await getDocs(query(collection(db, 'hunts', huntId, 'clues'), orderBy('displayOrder')))
    setClues(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  async function fetchAllUsers() {
    const snap = await getDocs(collection(db, 'profiles'))
    setAllUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  async function fetchReviews(huntId) {
    const snap = await getDocs(query(
      collection(db, 'playerProgress'),
      where('huntId', '==', huntId),
      where('status', '==', 'pending')
    ))
    // Enrich with clue titles
    const enriched = await Promise.all(snap.docs.map(async d => {
      const data = d.data()
      const clueDoc = await getDocs(query(
        collection(db, 'hunts', huntId, 'clues')
      ))
      const clueData = clueDoc.docs.find(c => c.id === data.clueId)
      return { id: d.id, ...data, clueTitle: clueData?.data()?.title || 'Unknown clue' }
    }))
    setReviews(enriched)
  }

  async function selectHunt(hunt) {
    setSelectedHunt(hunt)
    fetchClues(hunt.id)
    fetchAllUsers()
    fetchReviews(hunt.id)
  }

  async function createHunt(e) {
    e.preventDefault(); setSaving(true); setMsg(null)
    const data = {
      title: newHunt.title,
      description: newHunt.description || null,
      isActive: true,
      allowedUsers: [],
      mode: newHunt.mode,
      teamNames: newHunt.mode === 'teams' ? [newHunt.teamAName || 'Team A', newHunt.teamBName || 'Team B'] : [],
      teamAssignments: {},
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      startsAt: newHunt.startsAt ? new Date(newHunt.startsAt) : null,
      endsAt: newHunt.endsAt ? new Date(newHunt.endsAt) : null,
    }
    const ref = await addDoc(collection(db, 'hunts'), data)
    setMsg({ type: 'success', text: 'Hunt created! Add participants next.' })
    setNewHunt({ title: '', description: '', startsAt: '', endsAt: '', mode: 'individual', teamAName: 'Team A', teamBName: 'Team B' })
    await fetchHunts()
    const created = { id: ref.id, ...data, clueCount: 0 }
    setSelectedHunt(created)
    fetchClues(ref.id)
    fetchAllUsers()
    setTab('participants')
    setSaving(false)
  }

  async function toggleHunt(hunt) {
    await updateDoc(doc(db, 'hunts', hunt.id), { isActive: !hunt.isActive })
    fetchHunts()
  }

  async function deleteHunt(huntId) {
    if (!confirm('Delete this hunt and all its clues?')) return
    const cluesSnap = await getDocs(collection(db, 'hunts', huntId, 'clues'))
    await Promise.all(cluesSnap.docs.map(d => deleteDoc(d.ref)))
    await deleteDoc(doc(db, 'hunts', huntId))
    if (selectedHunt?.id === huntId) { setSelectedHunt(null); setClues([]) }
    fetchHunts()
  }

  async function toggleParticipant(uid, isAllowed) {
    const huntRef = doc(db, 'hunts', selectedHunt.id)
    if (isAllowed) {
      await updateDoc(huntRef, { allowedUsers: arrayRemove(uid) })
    } else {
      await updateDoc(huntRef, { allowedUsers: arrayUnion(uid) })
    }
    setSelectedHunt(prev => {
      const current = prev.allowedUsers || []
      const updated = isAllowed ? current.filter(u => u !== uid) : [...current, uid]
      return { ...prev, allowedUsers: updated }
    })
    setHunts(prev => prev.map(h => {
      if (h.id !== selectedHunt.id) return h
      const current = h.allowedUsers || []
      const updated = isAllowed ? current.filter(u => u !== uid) : [...current, uid]
      return { ...h, allowedUsers: updated }
    }))
  }

  async function assignTeam(uid, teamIndex) {
    const huntRef = doc(db, 'hunts', selectedHunt.id)
    const currentAssignment = selectedHunt.teamAssignments?.[uid]
    const newAssignments = { ...(selectedHunt.teamAssignments || {}) }
    if (currentAssignment === teamIndex) {
      delete newAssignments[uid]
    } else {
      newAssignments[uid] = teamIndex
    }
    await updateDoc(huntRef, { teamAssignments: newAssignments })
    setSelectedHunt(prev => ({ ...prev, teamAssignments: newAssignments }))
  }

  async function handleClueImageUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingClueImg(true)
    const form = new FormData()
    form.append('file', file)
    form.append('upload_preset', UPLOAD_PRESET)
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: 'POST', body: form })
    const data = await res.json()
    if (!data.error) setClueImageUrl(data.secure_url)
    setUploadingClueImg(false)
  }

  async function createClue(e) {
    e.preventDefault(); setSaving(true); setMsg(null)
    try {
      const token = crypto.randomUUID()
      const payload = {
        title: newClue.title, riddle: newClue.riddle,
        clueType: newClue.clueType,
        difficulty: Number(newClue.difficulty),
        points: DIFFICULTY_POINTS[newClue.difficulty],
        displayOrder: clues.length,
      }
      if (newClue.clueType === 'text') payload.answers = newClue.answers.map(a => a.toLowerCase().trim()).filter(Boolean)
      if (newClue.clueType === 'gps') {
        payload.lat = parseFloat(newClue.lat); payload.lng = parseFloat(newClue.lng)
        payload.gpsRadiusMeters = Number(newClue.gpsRadiusMeters)
      }
      if (newClue.clueType === 'qr') payload.qrToken = token
      if (newClue.clueType === 'image') payload.imageUrl = clueImageUrl
      if (newClue.clueType === 'date') {
        payload.targetDate = newClue.targetDate
        payload.dateTolerance = Number(newClue.dateTolerance)
      }

      await addDoc(collection(db, 'hunts', selectedHunt.id, 'clues'), payload)
      setMsg({ type: 'success', text: t('admin.clues.added') })
      setNewClue({ title: '', riddle: '', clueType: 'text', answers: [''], lat: '', lng: '', gpsRadiusMeters: 50, difficulty: 1, targetDate: '', dateTolerance: 0 })
      setClueImageUrl(null)

      if (newClue.clueType === 'qr') {
        const url = await QRCode.toDataURL(token, { width: 300, margin: 2 })
        setQrDataUrl(url); setQrToken(token)
      } else { setQrDataUrl(null); setQrToken(null) }

      fetchClues(selectedHunt.id)
    } catch (err) {
      console.error('createClue error:', err)
      setMsg({ type: 'error', text: err.message || 'Failed to add clue.' })
    } finally {
      setSaving(false)
    }
  }

  async function showClueQr(clue) {
    const url = await QRCode.toDataURL(clue.qrToken, { width: 300, margin: 2 })
    setQrDataUrl(url); setQrToken(clue.qrToken)
  }

  async function deleteClue(huntId, clueId) {
    if (!confirm('Delete this clue?')) return
    await deleteDoc(doc(db, 'hunts', huntId, 'clues', clueId))
    fetchClues(huntId)
  }

  async function reviewPhoto(progressId, approve) {
    await updateDoc(doc(db, 'playerProgress', progressId), {
      status: approve ? 'approved' : 'rejected'
    })
    setReviews(prev => prev.filter(r => r.id !== progressId))
  }

  async function fetchHuntImages(huntId) {
    setHuntImages([])
    // Clue hint images
    const cluesSnap = await getDocs(collection(db, 'hunts', huntId, 'clues'))
    const clueImages = cluesSnap.docs
      .filter(d => d.data().imageUrl)
      .map(d => ({ kind: 'hint', docId: d.id, docRef: d.ref, url: d.data().imageUrl, label: d.data().title, sub: 'Clue hint image' }))
    // Player proof photos
    const progressSnap = await getDocs(query(collection(db, 'playerProgress'), where('huntId', '==', huntId)))
    const proofImages = progressSnap.docs
      .filter(d => d.data().photoUrl)
      .map(d => ({ kind: 'proof', docId: d.id, docRef: d.ref, url: d.data().photoUrl, label: d.data().username, sub: `Proof photo · ${d.data().status || 'approved'}` }))
    setHuntImages([...clueImages, ...proofImages])
  }

  async function handleDeleteImage(img) {
    if (!confirm(`Delete this image from Cloudinary? This cannot be undone.`)) return
    if (!CLOUDINARY_API_SECRET) { setMsg({ type: 'error', text: 'VITE_CLOUDINARY_API_SECRET not set in .env' }); return }
    setDeletingImageId(img.docId + img.kind)
    try {
      await destroyCloudinaryImage(img.url)
      // Unlink from Firestore
      if (img.kind === 'hint') {
        await updateDoc(img.docRef, { imageUrl: null })
      } else {
        await updateDoc(img.docRef, { photoUrl: null })
      }
      setHuntImages(prev => prev.filter(i => !(i.docId === img.docId && i.kind === img.kind)))
      setMsg({ type: 'success', text: 'Image deleted from Cloudinary.' })
    } catch (err) {
      setMsg({ type: 'error', text: t('admin.deleteConfirm', { error: err.message }) })
    }
    setDeletingImageId(null)
  }

  function openWhatsApp(message) {
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank')
  }

  function generateInviteLink() {
    const link = `${window.location.origin}/join`
    openWhatsApp(`🏴\u200d☠️ You're invited to join the treasure hunt!\n\nCreate your free account here:\n${link}\n\nSee you on the hunt!`)
  }

  function handleCreatePlayer(e) {
    e.preventDefault()
    if (!newPlayer.username || !newPlayer.email || !newPlayer.password) return
    const payload = btoa(JSON.stringify({ username: newPlayer.username, email: newPlayer.email, password: newPlayer.password }))
    const link = `${window.location.origin}/join?preset=${payload}`
    const msg = `🏴\u200d☠️ Your treasure hunt account is ready!\n\n👤 Username: ${newPlayer.username}\n📧 Email: ${newPlayer.email}\n🔑 Password: ${newPlayer.password}\n\nTap here to activate your account:\n${link}`
    openWhatsApp(msg)
    setNewPlayer({ username: '', email: '', password: '' })
    setShowCreatePlayer(false)
    setShowPlayerPassword(false)
  }

  if (loading || !profile) return <div className="page" style={{ display:'flex', justifyContent:'center', paddingTop:'4rem' }}><div className="spinner" /></div>
  if (!profile.isAdmin) return null

  const allowedUsers = selectedHunt?.allowedUsers || []
  const teamAssignments = selectedHunt?.teamAssignments || {}
  const teamNames = selectedHunt?.teamNames || ['Team A', 'Team B']
  const isTeams = selectedHunt?.mode === 'teams'

  return (
    <div className="page-wide">
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: '1.5rem' }}>{t('admin.title')}</h1>

      <div className="tab-bar">
        <button className={`tab ${tab === 'hunts' ? 'active' : ''}`} onClick={() => setTab('hunts')}>{t('admin.tabs.hunts')}</button>
        {selectedHunt && (
          <>
            <button className={`tab ${tab === 'clues' ? 'active' : ''}`} onClick={() => setTab('clues')}>
              {t('admin.tabs.clues')} — {selectedHunt.title}
            </button>
            <button className={`tab ${tab === 'participants' ? 'active' : ''}`} onClick={() => { setTab('participants'); fetchAllUsers() }}>
              {t('admin.tabs.participants')} ({allowedUsers.length})
            </button>
            <button className={`tab ${tab === 'reviews' ? 'active' : ''}`} onClick={() => { setTab('reviews'); fetchReviews(selectedHunt.id) }}>
              {t('admin.tabs.reviews')} {reviews.length > 0 ? `(${reviews.length})` : ''}
            </button>
            <button className={`tab ${tab === 'images' ? 'active' : ''}`} onClick={() => { setTab('images'); fetchHuntImages(selectedHunt.id) }}>
              {t('admin.tabs.images')}
            </button>
          </>
        )}
        <button className={`tab ${tab === 'new-hunt' ? 'active' : ''}`} onClick={() => setTab('new-hunt')}>{t('admin.tabs.newHunt')}</button>
      </div>

      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

      {/* Hunts list */}
      {tab === 'hunts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {hunts.length === 0 && <p style={{ color: 'var(--text3)' }}>{t('admin.hunts.noHunts')}</p>}
          {hunts.map(hunt => (
            <div key={hunt.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{hunt.title}</span>
                <span className={`badge ${hunt.isActive ? 'badge-success' : 'badge-gray'}`}>
                  {hunt.isActive ? t('admin.hunts.active') : t('admin.hunts.inactive')}
                </span>
                {hunt.mode === 'teams' && <span className="badge badge-gold">{t('admin.hunts.teams')}</span>}
                <span style={{ fontSize: 13, color: 'var(--text3)', marginLeft: 'auto' }}>
                  {t('admin.hunts.clueCount', { count: hunt.clueCount })} · {t('admin.hunts.playerCount', { count: (hunt.allowedUsers || []).length })}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => { selectHunt(hunt); setTab('participants') }}>{t('admin.hunts.btnParticipants')}</button>
                <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => { selectHunt(hunt); setTab('clues') }}>{t('admin.hunts.btnClues')}</button>
                <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => { selectHunt(hunt); setTab('reviews'); fetchReviews(hunt.id) }}>{t('admin.hunts.btnReviews')}</button>
                <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => { selectHunt(hunt); setTab('images'); fetchHuntImages(hunt.id) }}>{t('admin.hunts.btnImages')}</button>
                <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => toggleHunt(hunt)}>{hunt.isActive ? t('admin.hunts.btnDeactivate') : t('admin.hunts.btnActivate')}</button>
                <button className="btn-danger" style={{ fontSize: 12 }} onClick={() => deleteHunt(hunt.id)}>{t('admin.hunts.btnDelete')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New hunt form */}
      {tab === 'new-hunt' && (
        <div className="card" style={{ maxWidth: 520 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: '1.25rem' }}>{t('admin.newHunt.heading')}</h2>
          <form onSubmit={createHunt}>
            <div className="form-group">
              <label>{t('admin.newHunt.labelTitle')}</label>
              <input placeholder={t('admin.newHunt.placeholderTitle')} required value={newHunt.title} onChange={e => setNewHunt(p => ({...p, title: e.target.value}))} />
            </div>
            <div className="form-group">
              <label>{t('admin.newHunt.labelDesc')}</label>
              <textarea rows={2} value={newHunt.description} onChange={e => setNewHunt(p => ({...p, description: e.target.value}))} style={{ resize: 'vertical' }} />
            </div>
            <div className="form-group">
              <label>{t('admin.newHunt.labelMode')}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className={newHunt.mode === 'individual' ? 'btn-primary' : 'btn-ghost'} style={{ flex: 1 }}
                  onClick={() => setNewHunt(p => ({...p, mode: 'individual'}))}>{t('admin.newHunt.modeIndividual')}</button>
                <button type="button" className={newHunt.mode === 'teams' ? 'btn-primary' : 'btn-ghost'} style={{ flex: 1 }}
                  onClick={() => setNewHunt(p => ({...p, mode: 'teams'}))}>{t('admin.newHunt.modeTeams')}</button>
              </div>
            </div>
            {newHunt.mode === 'teams' && (
              <div className="form-row" style={{ marginBottom: '1rem' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>{t('admin.newHunt.labelTeam1')}</label>
                  <input value={newHunt.teamAName} onChange={e => setNewHunt(p => ({...p, teamAName: e.target.value}))} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>{t('admin.newHunt.labelTeam2')}</label>
                  <input value={newHunt.teamBName} onChange={e => setNewHunt(p => ({...p, teamBName: e.target.value}))} />
                </div>
              </div>
            )}
            <div className="form-row" style={{ marginBottom: '1rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>{t('admin.newHunt.labelStartsAt')}</label>
                <input type="datetime-local" value={newHunt.startsAt} onChange={e => setNewHunt(p => ({...p, startsAt: e.target.value}))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>{t('admin.newHunt.labelEndsAt')}</label>
                <input type="datetime-local" value={newHunt.endsAt} onChange={e => setNewHunt(p => ({...p, endsAt: e.target.value}))} />
              </div>
            </div>
            <button className="btn-primary" type="submit" disabled={saving}>{saving ? t('admin.newHunt.creating') : t('admin.newHunt.create')}</button>
          </form>
        </div>
      )}

      {/* Participants */}
      {tab === 'participants' && selectedHunt && (
        <div style={{ maxWidth: 560 }}>
          <div style={{ marginBottom: '1rem' }}>
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>{selectedHunt.title} — {t('admin.participants.heading')}</h2>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>
              {t('admin.participants.subtitle')}
              {isTeams && ` ${t('admin.participants.subtitleTeams')}`}
              {allowedUsers.length === 0 && <strong> {t('admin.participants.noOne')}</strong>}
            </p>

            {/* Invite actions */}
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button
                className="btn-ghost"
                style={{ fontSize: 13 }}
                disabled={generatingLink}
                onClick={generateInviteLink}
              >
                {generatingLink ? '⏳ Generating…' : '📲 Send invite link'}
              </button>
              <button
                className="btn-ghost"
                style={{ fontSize: 13 }}
                onClick={() => { setShowCreatePlayer(s => !s); setMsg(null) }}
              >
                👤 {showCreatePlayer ? 'Cancel' : 'Create player'}
              </button>
            </div>

            {/* Create player form */}
            {showCreatePlayer && (
              <div className="card" style={{ marginTop: 14, background: 'var(--surface2)' }}>
                <h3 style={{ fontSize: 14, fontWeight: 800, marginBottom: 12, color: 'var(--primary)' }}>
                  👤 Create a player account
                </h3>
                <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12, lineHeight: 1.5 }}>
                  Fill in the account details. We'll open WhatsApp with the credentials + a one-tap activation link to send to the player.
                </p>
                <form onSubmit={handleCreatePlayer}>
                  <div className="form-group">
                    <label style={{ fontSize: 12 }}>Username (display name)</label>
                    <input
                      placeholder="e.g. Sara"
                      required
                      value={newPlayer.username}
                      onChange={e => setNewPlayer(p => ({ ...p, username: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label style={{ fontSize: 12 }}>Email</label>
                    <input
                      type="email"
                      placeholder="sara@example.com"
                      required
                      value={newPlayer.email}
                      onChange={e => setNewPlayer(p => ({ ...p, email: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label style={{ fontSize: 12 }}>Password</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showPlayerPassword ? 'text' : 'password'}
                        placeholder="At least 6 characters"
                        required
                        minLength={6}
                        value={newPlayer.password}
                        onChange={e => setNewPlayer(p => ({ ...p, password: e.target.value }))}
                        style={{ paddingRight: '2.5rem' }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPlayerPassword(s => !s)}
                        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15 }}
                      >{showPlayerPassword ? '🙈' : '👁️'}</button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn-primary"
                      type="submit"
                      disabled={creatingPlayer}
                      style={{ flex: 1 }}
                    >
                      {creatingPlayer ? '⏳ Creating…' : '📲 Create & send via WhatsApp'}
                    </button>
                  </div>
                </form>
                <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10, lineHeight: 1.5 }}>
                  ⚠️ The activation link expires in 7 days. After the player activates, add them to a hunt from the list below.
                </p>
              </div>
            )}
          </div>
          {isTeams && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {teamNames.map((name, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: TEAM_COLORS[i] + '22', border: `1px solid ${TEAM_COLORS[i]}` }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: TEAM_COLORS[i] }} />
                  <span style={{ fontSize: 13, fontWeight: 500, color: TEAM_COLORS[i] }}>{name}</span>
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                    ({Object.values(teamAssignments).filter(t => t === i).length})
                  </span>
                </div>
              ))}
            </div>
          )}
          {allUsers.length === 0 ? (
            <p style={{ color: 'var(--text3)', fontSize: 14 }}>{t('admin.participants.noUsers')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {allUsers.map(u => {
                const isAllowed = allowedUsers.includes(u.id)
                const teamIdx = teamAssignments[u.id]
                return (
                  <div key={u.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0.75rem 1rem' }}>
                    <input type="checkbox" checked={isAllowed} onChange={() => toggleParticipant(u.id, isAllowed)}
                      style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: 500, fontSize: 14 }}>{u.username}</span>
                      {u.isAdmin && <span className="badge badge-gold" style={{ marginLeft: 8, fontSize: 11 }}>Admin</span>}
                    </div>
                    {isTeams && isAllowed && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        {teamNames.map((name, i) => (
                          <button key={i} onClick={() => assignTeam(u.id, i)}
                            style={{
                              fontSize: 12, padding: '3px 10px', borderRadius: 12, border: `1px solid ${TEAM_COLORS[i]}`,
                              background: teamIdx === i ? TEAM_COLORS[i] : 'transparent',
                              color: teamIdx === i ? '#fff' : TEAM_COLORS[i],
                              cursor: 'pointer', fontWeight: 500,
                            }}>
                            {name}
                          </button>
                        ))}
                      </div>
                    )}
                    {!isTeams && (
                      <span style={{ fontSize: 12, color: isAllowed ? 'var(--success)' : 'var(--text3)' }}>
                        {isAllowed ? t('admin.participants.allowed') : t('admin.participants.noAccess')}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Photo Reviews */}
      {tab === 'reviews' && selectedHunt && (
        <div style={{ maxWidth: 600 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: '1rem' }}>{selectedHunt.title} — {t('admin.reviews.heading')}</h2>
          {reviews.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', color: 'var(--text3)', padding: '2rem' }}>
              {t('admin.reviews.noPending')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {reviews.map(r => (
                <div key={r.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{r.username}</div>
                      <div style={{ fontSize: 12, color: 'var(--text3)' }}>{t('admin.reviews.clueLabel', { title: r.clueTitle, points: r.points })}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => reviewPhoto(r.id, true)}>{t('admin.reviews.approve')}</button>
                      <button className="btn-danger" style={{ fontSize: 12 }} onClick={() => reviewPhoto(r.id, false)}>{t('admin.reviews.reject')}</button>
                    </div>
                  </div>
                  {r.photoUrl && (
                    <img src={r.photoUrl} alt="submission" style={{ width: '100%', maxHeight: 300, objectFit: 'cover', borderRadius: 8, marginTop: 12 }} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Images */}
      {tab === 'images' && selectedHunt && (
        <div style={{ maxWidth: 620 }}>
          <div style={{ marginBottom: '1rem' }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{selectedHunt.title} — {t('admin.images.heading')}</h2>
            <p style={{ fontSize: 13, color: 'var(--text2)' }}>
              {t('admin.images.subtitle')}
            </p>
            {!CLOUDINARY_API_SECRET && (
              <div className="alert alert-error" style={{ marginTop: 10 }}>
                ⚠️ {t('admin.images.missingEnv')}
              </div>
            )}
          </div>
          {huntImages.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', color: 'var(--text3)', padding: '2rem' }}>
              {t('admin.images.noImages')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {huntImages.map(img => {
                const key = img.docId + img.kind
                const isDeleting = deletingImageId === key
                return (
                  <div key={key} className="card" style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '0.875rem 1rem' }}>
                    <img
                      src={img.url} alt=""
                      style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, flexShrink: 0, border: '2px solid var(--border)', cursor: 'pointer' }}
                      onClick={() => window.open(img.url, '_blank')}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{img.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                        {img.kind === 'hint' ? t('admin.images.hintLabel') : t('admin.images.proofLabel')} · {img.sub}
                      </div>
                    </div>
                    <button
                      className="btn-danger"
                      style={{ fontSize: 12, flexShrink: 0 }}
                      disabled={isDeleting || !CLOUDINARY_API_SECRET}
                      onClick={() => handleDeleteImage(img)}
                    >
                      {isDeleting ? t('admin.images.deleting') : t('admin.images.delete')}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Clues */}
      {tab === 'clues' && selectedHunt && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{t('admin.clues.heading', { count: clues.length })}</h2>
            {clues.length === 0 && <p style={{ color: 'var(--text3)', fontSize: 14 }}>{t('admin.clues.noClues')}</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {clues.map(clue => (
                <div key={clue.id} className="card" style={{ padding: '0.75rem 1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 13 }}>{CLUE_TYPE_ICONS[clue.clueType]}</span>
                        <span style={{ fontWeight: 500, fontSize: 14 }}>{clue.title}</span>
                      </div>
                      {clue.imageUrl && (
                        <img src={clue.imageUrl} alt="clue" style={{ width: '100%', maxHeight: 120, objectFit: 'cover', borderRadius: 6, marginBottom: 4 }} />
                      )}
                      <p style={{ fontSize: 12, color: 'var(--text2)' }}>{clue.riddle}</p>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                        <span style={{ fontSize: 11 }}>{'⭐'.repeat(clue.difficulty || 1)}</span>
                        <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700 }}>+{clue.points} pts</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      {clue.clueType === 'qr' && (
                        <button className="btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => showClueQr(clue)}>QR</button>
                      )}
                      <button className="btn-danger" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => deleteClue(selectedHunt.id, clue.id)}>✕</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {qrDataUrl && (
              <div className="card" style={{ marginTop: 16, textAlign: 'center' }}>
                <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>{t('admin.clues.qrPrintLabel')}</p>
                <img src={qrDataUrl} alt="QR code" style={{ width: 200, height: 200, borderRadius: 8 }} />
                <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8, wordBreak: 'break-all' }}>{qrToken}</p>
                <a href={qrDataUrl} download="clue-qr.png">
                  <button className="btn-ghost" style={{ marginTop: 8, fontSize: 12 }}>{t('admin.clues.downloadQr')}</button>
                </a>
              </div>
            )}
          </div>

          <div className="card">
            <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: '1rem' }}>{t('admin.clues.addHeading')}</h2>
            <form onSubmit={createClue}>
              <div className="form-group">
                <label>{t('admin.clues.labelTitle')}</label>
                <input placeholder={t('admin.clues.placeholderTitle')} required value={newClue.title} onChange={e => setNewClue(p => ({...p, title: e.target.value}))} />
              </div>
              <div className="form-group">
                <label>{t('admin.clues.labelRiddle')}</label>
                <textarea rows={3} required style={{ resize: 'vertical' }} value={newClue.riddle} onChange={e => setNewClue(p => ({...p, riddle: e.target.value}))} />
              </div>
              <div className="form-group">
                <label>{t('admin.clues.labelType')}</label>
                <select value={newClue.clueType} onChange={e => { setNewClue(p => ({...p, clueType: e.target.value})); setClueImageUrl(null) }}>
                  {CLUE_TYPES.map(t => <option key={t} value={t}>{CLUE_TYPE_ICONS[t]} {t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </select>
              </div>
              {newClue.clueType === 'text' && (
                <div className="form-group">
                  <label>{t('admin.clues.labelAnswer')}</label>
                  {newClue.answers.map((ans, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <input
                        placeholder={t('admin.clues.placeholderAnswer')}
                        required={i === 0}
                        value={ans}
                        onChange={e => setNewClue(p => {
                          const answers = [...p.answers]
                          answers[i] = e.target.value
                          return { ...p, answers }
                        })}
                      />
                      <button type="button" onClick={() => setNewClue(p => ({ ...p, answers: p.answers.filter((_, j) => j !== i) }))}
                        disabled={newClue.answers.length === 1}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text3)', flexShrink: 0 }}>✕</button>
                    </div>
                  ))}
                  <button type="button" className="btn-ghost" style={{ fontSize: 12 }}
                    onClick={() => setNewClue(p => ({ ...p, answers: [...p.answers, ''] }))}>＋ Add answer</button>
                </div>
              )}
              {newClue.clueType === 'gps' && (
                <>
                  <div className="form-row" style={{ marginBottom: '0.75rem' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>{t('admin.clues.labelLat')}</label>
                      <input type="number" step="any" placeholder="51.5074" required value={newClue.lat} onChange={e => setNewClue(p => ({...p, lat: e.target.value}))} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>{t('admin.clues.labelLng')}</label>
                      <input type="number" step="any" placeholder="-0.1278" required value={newClue.lng} onChange={e => setNewClue(p => ({...p, lng: e.target.value}))} />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>{t('admin.clues.labelRadius')}</label>
                    <input type="number" min={10} max={500} value={newClue.gpsRadiusMeters} onChange={e => setNewClue(p => ({...p, gpsRadiusMeters: e.target.value}))} />
                  </div>
                </>
              )}
              {newClue.clueType === 'qr' && (
                <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: '0.75rem', background: 'var(--surface2)', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)' }}>
                  {t('admin.clues.qrHint')}
                </p>
              )}
              {newClue.clueType === 'image' && (
                <div className="form-group">
                  <label>{t('admin.clues.labelHintImage')}</label>
                  <input ref={clueImgRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleClueImageUpload} />
                  {clueImageUrl ? (
                    <div>
                      <img src={clueImageUrl} alt="preview" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }} />
                      <button type="button" className="btn-ghost" style={{ fontSize: 12, width: '100%' }} onClick={() => clueImgRef.current.click()}>{t('admin.clues.changeImage')}</button>
                    </div>
                  ) : (
                    <button type="button" className="btn-ghost" style={{ width: '100%' }} onClick={() => clueImgRef.current.click()} disabled={uploadingClueImg}>
                      {uploadingClueImg ? t('admin.clues.uploadingImage') : t('admin.clues.uploadImage')}
                    </button>
                  )}
                  <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>{t('admin.clues.playersSeeImage')}</p>
                </div>
              )}
              {newClue.clueType === 'date' && (
                <>
                  <div className="form-group">
                    <label>Target Date</label>
                    <input type="date" required value={newClue.targetDate} onChange={e => setNewClue(p => ({...p, targetDate: e.target.value}))} />
                  </div>
                  <div className="form-group">
                    <label>Tolerance (± days, 0 = exact)</label>
                    <input type="number" min={0} max={365} value={newClue.dateTolerance} onChange={e => setNewClue(p => ({...p, dateTolerance: e.target.value}))} />
                  </div>
                </>
              )}
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label>{t('admin.clues.labelDifficulty')}</label>
                <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                  {[1,2,3,4,5].map(d => (
                    <button key={d} type="button" className="star-btn"
                      style={{ opacity: newClue.difficulty >= d ? 1 : 0.25, background: 'none', border: 'none' }}
                      onClick={() => setNewClue(p => ({...p, difficulty: d}))}>
                      ⭐
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                    background: DIFFICULTY_BG[newClue.difficulty], color: DIFFICULTY_COLORS[newClue.difficulty]
                  }}>
                    {DIFFICULTY_LABELS[newClue.difficulty]}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>
                    {t('admin.clues.pointsLabel', { points: DIFFICULTY_POINTS[newClue.difficulty] })}
                  </span>
                </div>
              </div>
              <button className="btn-primary" type="submit" disabled={saving || (newClue.clueType === 'image' && !clueImageUrl)} style={{ width: '100%' }}>
                {saving ? t('admin.clues.adding') : t('admin.clues.add')}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
