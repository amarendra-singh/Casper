// Composite fraud score 0-100 display.
// compact=true → inline colored number for table cells
// compact=false → SVG semi-arc meter with label

function scoreColor(score) {
  if (score == null) return '#6b7280'
  if (score >= 70) return '#ef4444'
  if (score >= 40) return '#f97316'
  if (score >= 20) return '#f59e0b'
  return '#22c55e'
}

function scoreLabel(score) {
  if (score == null) return '—'
  if (score >= 70) return 'CRITICAL'
  if (score >= 40) return 'HIGH'
  if (score >= 20) return 'MEDIUM'
  return 'LOW'
}

export default function CompositeScoreMeter({ score, compact = false }) {
  const color   = scoreColor(score)
  const label   = scoreLabel(score)
  const display = score != null ? score.toFixed(1) : '—'

  if (compact) {
    return (
      <span className="csm-compact" style={{ color, fontWeight: 700, fontSize: 12 }}>
        {display}
      </span>
    )
  }

  // SVG semi-arc meter
  const radius        = 38  // Matches SVG path "A 38 38"
  const circumference = Math.PI * radius   // semi-arc circumference
  const filled        = score != null ? (score / 100) * circumference : 0

  return (
    <div className="csm-root">
      <svg width="88" height="52" viewBox="0 0 88 52">
        <path
          d="M 6 46 A 38 38 0 0 1 82 46"
          fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" strokeLinecap="round"
        />
        {score != null && (
          <path
            d="M 6 46 A 38 38 0 0 1 82 46"
            fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
          />
        )}
      </svg>
      <div className="csm-value" style={{ color }}>{display}</div>
      <div className="csm-label" style={{ color }}>{label}</div>
    </div>
  )
}
