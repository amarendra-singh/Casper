// Shared formatters for Flipkart P&L views.

export const fmt = (v, d = 0) => {
  if (v == null) return '—'
  const n = Number(v)
  const abs = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
  return (n < 0 ? '-' : '') + '₹' + abs
}

export const fmtN   = v => v == null ? '—' : Number(v).toLocaleString('en-IN')
export const fmtPct = v => v == null ? '—' : Number(v).toFixed(1) + '%'

const parseLocalDate = s => s ? new Date(s + 'T00:00:00') : null

export const fmtPeriod = (start, end) => {
  const s = parseLocalDate(start), e = parseLocalDate(end)
  if (!s || !e) return '—'
  return `${s.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} — ${e.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
}
