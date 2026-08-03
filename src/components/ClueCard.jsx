import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { collection, query, where, getDocs, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

const TYPE_BADGE = { text: 'badge-text', gps: 'badge-gps', qr: 'badge-qr', image: 'badge-image' }
const DIFF_CLASS = { 1: 'diff-1', 2: 'diff-2', 3: 'diff-3', 4: 'diff-4', 5: 'diff-5' }
const DIFF_LABEL = { 1: 'Easy', 2: 'Medium', 3: 'Hard', 4: 'Very Hard', 5: 'Expert' }

export default function ClueCard({ clue, completed, pending, onComplete }) {
  const { user, profile } = useAuth()
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [answer, setAnswer] = useState('')
  const [gpsStatus, setGpsStatus] = useState(null)
  const [qrInput, setQrInput] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
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

    // If a doc exists and was rejected, allow resubmission by updating it
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
      // Already pending or approved — don't allow another submission
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

  const cardStyle = completed
    ? { background: '#dcfce7', borderColor: '#86efac' }
    : pending
      ? { background: '#fef9c3', borderColor: '#fde047' }
      : { borderLeft: `4px solid ${['#22c55e','#3b82f6','#f97316','#ef4444','#8b5cf6'][diff-1]}` }

  return (
    <div className="card" style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className={`badge ${TYPE_BADGE[clue.clueType] || 'badge-text'}`}>{typeLabels[clue.clueType]}</span>
          <span className={`badge ${DIFF_CLASS[diff]}`}>
            {'⭐'.repeat(diff)} {DIFF_LABEL[diff]}
          </span>
          <span className="badge badge-gold">{t('clue.points', { points: clue.points })}</span>
        </div>
        {completed && <span className="badge badge-success">✓ {t('clue.found')}</span>}
        {pending && !completed && <span className="badge badge-pending">{t('clue.pendingReview')}</span>}
      </div>

      <h3 style={{ fontWeight: 800, fontSize: 16, marginBottom: 6, color: 'var(--primary)' }}>{clue.title}</h3>
      <p style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 12, lineHeight: 1.6 }}>{clue.riddle}</p>

      {/* Image hint preview (always shown for image clues) */}
      {clue.clueType === 'image' && clue.imageUrl && (
        <img
          src={clue.imageUrl}
          alt="clue hint"
          style={{ width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 8, marginBottom: 12, cursor: 'pointer' }}
          onClick={() => window.open(clue.imageUrl, '_blank')}
        />
      )}

      {!isDone && (
        <button className="btn-ghost" style={{ fontSize: 13, width: '100%' }}
          onClick={() => { setOpen(o => !o); setError(null); setSuccess(null) }}>
          {open ? t('clue.hide') : (clue.clueType === 'image' ? t('clue.submitPhoto') : t('clue.submit'))}
        </button>
      )}

      {open && !isDone && (
        <div style={{ marginTop: 12 }}>
          {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}
          {success && <div className="alert alert-success" style={{ marginBottom: 8 }}>{success}</div>}

          {clue.clueType === 'text' && (
            <form onSubmit={handleTextSubmit} style={{ display: 'flex', gap: 8 }}>
              <input placeholder={t('clue.yourAnswer')} value={answer} onChange={e => setAnswer(e.target.value)} required />
              <button className="btn-primary" type="submit" disabled={loading} style={{ flexShrink: 0, padding: '0.5rem 1rem' }}>
                {loading ? <span className="spinner" style={{ width:14, height:14 }} /> : t('clue.check')}
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
