import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { collection, query, where, getDocs, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

const TYPE_BADGE = { text: 'badge-text', gps: 'badge-gps', qr: 'badge-qr', image: 'badge-image' }
const TYPE_EMOJI = { text: '💬', gps: '📍', qr: '📷', image: '🖼️' }
const DIFF_CLASS = { 1: 'diff-1', 2: 'diff-2', 3: 'diff-3', 4: 'diff-4', 5: 'diff-5' }
const DIFF_KEY = { 1: 'clue.diffEasy', 2: 'clue.diffMedium', 3: 'clue.diffHard', 4: 'clue.diffVeryHard', 5: 'clue.diffExpert' }
const DIFF_COLORS = ['#22c55e', '#3b82f6', '#f97316', '#ef4444', '#8b5cf6']

export default function ClueCard({ clue, completed, pending, onComplete }) {
  const { user, profile } = useAuth()
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [answer, setAnswer] = useState('')
  const [gpsStatus, setGpsStatus] = useState(null)
  const [qrInput, setQrInput] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [submitOpen, setSubmitOpen] = useState(false)
  const html5QrcodeRef = useRef(null)
  const proofRef = useRef()

  useEffect(() => { return () => stopScanner() }, [])

  async function markComplete(photoUrl = null) {
    setLoading(true)
    const existingSnap = await getDocs(query(
      collection(db, 'playerProgress'),
      where('playerId', '==', user.uid),
      where('clueId', '==', clue.id)
    ))

    if (!existingSnap.empty) {
      const existingDoc = existingSnap.docs[0]
      const existingStatus = existingDoc.data().status
      if (existingStatus === 'rejected' && photoUrl) {
        await updateDoc(existingDoc.ref, {
          photoUrl,
          status: 'pending',
          completedAt: serverTimestamp(),
        })
        setSuccess(t('clue.photoSubmitted'))
        setLoading(false)
        return
      }
      setError(t('clue.alreadyDone'))
      setLoading(false)
      return
    }

    const isImageClue = clue.clueType === 'image'
    await addDoc(collection(db, 'playerProgress'), {
      playerId: user.uid,
      username: profile.username,
      huntId: clue.huntId,
      clueId: clue.id,
      points: clue.points,
      photoUrl: photoUrl || null,
      status: isImageClue ? 'pending' : 'approved',
      completedAt: serverTimestamp(),
    })

    if (isImageClue) {
      setSuccess(t('clue.photoSubmitted'))
    } else {
      setSuccess(t('clue.clueFound'))
      onComplete(clue.id)
    }
    setLoading(false)
  }

  async function handleTextSubmit(e) {
    e.preventDefault(); setError(null)
    if (answer.trim().toLowerCase() !== clue.answer?.toLowerCase()) {
      setError(t('clue.wrongAnswer')); return
    }
    await markComplete()
  }

  async function handleGpsCheck() {
    setError(null); setGpsStatus('checking')
    if (!navigator.geolocation) { setError(t('clue.noGeo')); setGpsStatus(null); return }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const dist = haversine(pos.coords.latitude, pos.coords.longitude, clue.lat, clue.lng)
        if (dist <= clue.gpsRadiusMeters) { setGpsStatus('success'); markComplete() }
        else { setGpsStatus('far'); setError(t('clue.tooFar', { dist: Math.round(dist), radius: clue.gpsRadiusMeters })) }
      },
      err => { setError(t('clue.locationError', { error: err.message })); setGpsStatus(null) },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  async function startScanner() {
    setScannerOpen(true)
    setTimeout(async () => {
      const { Html5Qrcode } = await import('html5-qrcode')
      html5QrcodeRef.current = new Html5Qrcode('qr-reader')
      try {
        await html5QrcodeRef.current.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: 200 },
          async (text) => {
            await stopScanner(); setScannerOpen(false)
            if (text === clue.qrToken) await markComplete()
            else setError(t('clue.qrMismatch'))
          },
          () => {}
        )
      } catch (err) { setError(t('clue.cameraError', { error: err.message })); setScannerOpen(false) }
    }, 100)
  }

  async function stopScanner() {
    if (html5QrcodeRef.current) {
      try { await html5QrcodeRef.current.stop() } catch {}
      html5QrcodeRef.current = null
    }
  }

  async function handleQrManual(e) {
    e.preventDefault(); setError(null)
    if (qrInput.trim() !== clue.qrToken) { setError(t('clue.invalidToken')); return }
    await markComplete()
  }

  async function handleProofUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setLoading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('upload_preset', UPLOAD_PRESET)
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: 'POST', body: form })
      const data = await res.json()
      if (data.error) throw new Error(data.error.message)
      await markComplete(data.secure_url)
    } catch (err) {
      setError(t('clue.uploadFailed', { error: err.message }))
      setLoading(false)
    }
  }

  const typeLabels = { text: t('clue.riddle'), gps: t('clue.gps'), qr: t('clue.qr'), image: t('clue.image') }
  const isDone = completed || pending
  const diff = clue.difficulty || 1
  const accentColor = DIFF_COLORS[diff - 1]

  const cardBg = completed ? '#dcfce7' : pending ? '#fef9c3' : 'var(--surface)'
  const cardBorderColor = completed ? '#86efac' : pending ? '#fde047' : 'var(--border)'

  // ── COLLAPSED TILE ──────────────────────────────────────────────
  if (!expanded) {
    return (
      <div
        onClick={() => setExpanded(true)}
        className="clue-tile"
        style={{
          background: cardBg,
          border: `2px solid ${cardBorderColor}`,
          borderLeft: `4px solid ${accentColor}`,
        }}
      >
        {/* Top row: type + status */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
          <span className={`badge ${TYPE_BADGE[clue.clueType] || 'badge-text'}`} style={{ fontSize: 10, padding: '2px 7px' }}>
            {TYPE_EMOJI[clue.clueType]} {typeLabels[clue.clueType]}
          </span>
          {completed && <span style={{ fontSize: 17 }} title={t('clue.statusDone')}>✅</span>}
          {pending && !completed && <span style={{ fontSize: 17 }} title={t('clue.statusReview')}>⏳</span>}
          {!completed && !pending && <span style={{ fontSize: 15, color: 'var(--text3)' }} title={t('clue.statusOpen')}>○</span>}
        </div>

        {/* Title */}
        <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--primary)', lineHeight: 1.3, marginBottom: 8 }}>
          {clue.title}
        </div>

        {/* Bottom row: difficulty + points */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className={`badge ${DIFF_CLASS[diff]}`} style={{ fontSize: 10, padding: '2px 7px' }}>
            {'⭐'.repeat(diff)}
          </span>
          <span className="badge badge-gold" style={{ fontSize: 10, padding: '2px 7px' }}>
            {clue.points} pts
          </span>
        </div>
      </div>
    )
  }

  // ── EXPANDED CARD ───────────────────────────────────────────────
  return (
    <div
      className="clue-tile-expanded"
      style={{
        background: cardBg,
        border: `2px solid ${cardBorderColor}`,
        borderLeft: `4px solid ${accentColor}`,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className={`badge ${TYPE_BADGE[clue.clueType] || 'badge-text'}`}>
            {TYPE_EMOJI[clue.clueType]} {typeLabels[clue.clueType]}
          </span>
          <span className={`badge ${DIFF_CLASS[diff]}`}>{'⭐'.repeat(diff)} {t(DIFF_KEY[diff])}</span>
          <span className="badge badge-gold">{t('clue.points', { points: clue.points })}</span>
          {completed && <span className="badge badge-success">✓ {t('clue.found')}</span>}
          {pending && !completed && <span className="badge badge-pending">{t('clue.pendingReview')}</span>}
        </div>
        <button
          onClick={() => { setExpanded(false); setSubmitOpen(false); setError(null); setSuccess(null) }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text3)', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
        >✕</button>
      </div>

      <h3 style={{ fontWeight: 800, fontSize: 16, marginBottom: 6, color: 'var(--primary)' }}>{clue.title}</h3>
      <p style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 12, lineHeight: 1.6 }}>{clue.riddle}</p>

      {clue.clueType === 'image' && clue.imageUrl && (
        <img
          src={clue.imageUrl}
          alt="clue hint"
          style={{ width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 8, marginBottom: 12, cursor: 'pointer' }}
          onClick={() => window.open(clue.imageUrl, '_blank')}
        />
      )}

      {success && <div className="alert alert-success" style={{ marginBottom: 8 }}>{success}</div>}

      {!isDone && !submitOpen && (
        <button className="btn-ghost" style={{ fontSize: 13, width: '100%' }}
          onClick={() => { setSubmitOpen(true); setError(null) }}>
          {clue.clueType === 'image' ? t('clue.submitPhoto') : t('clue.submit')}
        </button>
      )}

      {submitOpen && !isDone && (
        <div style={{ marginTop: 8 }}>
          {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}

          {clue.clueType === 'text' && (
            <form onSubmit={handleTextSubmit} style={{ display: 'flex', gap: 8 }}>
              <input placeholder={t('clue.yourAnswer')} value={answer} onChange={e => setAnswer(e.target.value)} required />
              <button className="btn-primary" type="submit" disabled={loading} style={{ flexShrink: 0, padding: '0.5rem 1rem' }}>
                {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : t('clue.check')}
              </button>
            </form>
          )}

          {clue.clueType === 'gps' && (
            <div>
              <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}
                dangerouslySetInnerHTML={{ __html: t('clue.gpsInstruction', { radius: clue.gpsRadiusMeters }) }} />
              <button className="btn-primary" onClick={handleGpsCheck} disabled={loading || gpsStatus === 'checking'} style={{ width: '100%' }}>
                {gpsStatus === 'checking' ? t('clue.checkingLocation') : t('clue.checkLocation')}
              </button>
            </div>
          )}

          {clue.clueType === 'qr' && (
            <div>
              <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>{t('clue.qrInstruction')}</p>
              {!scannerOpen ? (
                <button className="btn-primary" style={{ width: '100%', marginBottom: 8 }} onClick={startScanner}>
                  {t('clue.openCamera')}
                </button>
              ) : (
                <div>
                  <div id="qr-reader" style={{ width: '100%', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }} />
                  <button className="btn-ghost" style={{ width: '100%', marginBottom: 8 }} onClick={() => { stopScanner(); setScannerOpen(false) }}>
                    {t('clue.cancel')}
                  </button>
                </div>
              )}
              <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>{t('clue.manualEntry')}</p>
              <form onSubmit={handleQrManual} style={{ display: 'flex', gap: 8 }}>
                <input placeholder={t('clue.qrToken')} value={qrInput} onChange={e => setQrInput(e.target.value)} required />
                <button className="btn-ghost" type="submit" style={{ flexShrink: 0 }}>{t('clue.go')}</button>
              </form>
            </div>
          )}

          {clue.clueType === 'image' && (
            <div>
              <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10 }}>{t('clue.imageInstruction')}</p>
              <input ref={proofRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleProofUpload} />
              <button className="btn-primary" style={{ width: '100%' }} disabled={loading} onClick={() => proofRef.current.click()}>
                {loading ? t('clue.uploading') : t('clue.takePhoto')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
