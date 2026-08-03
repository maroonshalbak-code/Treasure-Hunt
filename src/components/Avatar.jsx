const COLORS = ['#e74c3c','#e67e22','#f39c12','#2ecc71','#1abc9c','#3498db','#9b59b6','#e91e63']

export default function Avatar({ username = '?', photoUrl = null, size = 40 }) {
  const color = COLORS[(username || '?').charCodeAt(0) % COLORS.length]
  const initials = (username || '?').slice(0, 2).toUpperCase()

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={username}
        style={{
          width: size, height: size, borderRadius: '50%',
          objectFit: 'cover', flexShrink: 0,
          border: '2px solid var(--border)',
        }}
      />
    )
  }

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: color, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 700, flexShrink: 0,
    }}>
      {initials}
    </div>
  )
}
