import { useState } from 'react'
// xlsx is lazy-loaded inside the file handler (keeps it out of the main bundle).

/**
 * UploadAdReportModal
 * ──────────────────────────────────────────────────────────────────────
 * Upload a platform ad-campaign report (CSV / XLSX) and apply per-SKU
 * AD ₹/unit to the SKUs page rows.
 *
 * Expected columns (case-insensitive):
 *   • SKU        — matches Casper sku_name OR platform_sku_name (alias)
 *   • Spend      — total ad spend in ₹
 *   • Orders     — total orders attributed to that ad
 *
 * Computed:  ad_amt_per_unit = Spend / Orders
 *
 * Matching priority for each report row:
 *   1. exact match on Casper sku_name (case-insensitive)
 *   2. exact match on row.platAliases[platform.id] (case-insensitive)
 *   3. unmatched → shown in preview, skipped on apply
 *
 * Props:
 *   platform   — { id, name, … }
 *   rows       — current SKU rows (for matching)
 *   onApply    — (updates: [{ rowId, adAmt }]) => void   parent merges into platOverrides
 *   onClose    — () => void
 */
export default function UploadAdReportModal({ platform, rows, onApply, onClose }) {
  const [file,        setFile]        = useState(null)
  const [parsing,     setParsing]     = useState(false)
  const [parseError,  setParseError]  = useState('')
  const [matched,     setMatched]     = useState([])  // [{ rowId, sku, adAmt, spend, orders }]
  const [unmatched,   setUnmatched]   = useState([])  // [{ sku, spend, orders, reason }]

  const norm = s => String(s ?? '').trim().toLowerCase()

  const handleFile = e => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setParseError('')
    setParsing(true)

    const reader = new FileReader()
    reader.onload = async ev => {
      try {
        const XLSX = await import('xlsx')
        const wb = XLSX.read(ev.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, { defval: '' })

        // Find columns case-insensitively
        const findKey = (row, ...names) => {
          const keys = Object.keys(row)
          for (const n of names) {
            const k = keys.find(k => k.trim().toLowerCase() === n.toLowerCase())
            if (k) return k
          }
          return null
        }

        if (raw.length === 0) { setParseError('File is empty.'); setParsing(false); return }
        const sample = raw[0]
        const skuKey    = findKey(sample, 'SKU', 'SKU Name', 'Product')
        const spendKey  = findKey(sample, 'Spend', 'Total Spend', 'Amount Spent', 'Cost')
        const ordersKey = findKey(sample, 'Orders', 'Total Orders', 'Conversions')

        if (!skuKey || !spendKey || !ordersKey) {
          setParseError(`Missing columns. Need: SKU, Spend, Orders. Found: ${Object.keys(sample).join(', ')}`)
          setParsing(false)
          return
        }

        const M = []  // matched
        const U = []  // unmatched

        raw.forEach(r => {
          const sku    = String(r[skuKey] ?? '').trim()
          const spend  = parseFloat(r[spendKey])
          const orders = parseFloat(r[ordersKey])
          if (!sku) return
          if (!Number.isFinite(spend) || !Number.isFinite(orders) || orders <= 0) {
            U.push({ sku, spend, orders, reason: 'invalid spend/orders' })
            return
          }
          const adAmt = +(spend / orders).toFixed(2)

          // Try direct sku_name match
          const skuLower = norm(sku)
          let row = rows.find(rr => norm(rr.sku) === skuLower)
          // Fallback: alias match
          if (!row) {
            row = rows.find(rr => {
              const alias = rr.platAliases?.[platform.id]
              return alias && norm(alias) === skuLower
            })
          }

          if (row) {
            M.push({ rowId: row.id, sku: row.sku, adAmt, spend, orders })
          } else {
            U.push({ sku, spend, orders, reason: 'no matching SKU' })
          }
        })

        setMatched(M)
        setUnmatched(U)
      } catch (err) {
        setParseError(err?.message || 'Failed to parse file')
      } finally {
        setParsing(false)
      }
    }
    reader.readAsArrayBuffer(f)
  }

  const apply = () => {
    if (matched.length === 0) return
    onApply(matched.map(m => ({ rowId: m.rowId, adAmt: m.adAmt })))
  }

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-title">Upload Ad Report · {platform.name}</div>

        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>
          File should have columns: <strong>SKU</strong>, <strong>Spend</strong>, <strong>Orders</strong>.
          Per-SKU AD ₹/unit = Spend ÷ Orders.
        </div>

        <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile}
          style={{ marginBottom: 10 }} />

        {parsing && <div style={{ fontSize: 12 }}>Parsing…</div>}
        {parseError && (
          <div style={{
            padding: '8px 12px', background: 'var(--red-dim)',
            border: '1px solid var(--red)', borderRadius: 'var(--radius-sm)',
            color: 'var(--red)', fontSize: 12, marginBottom: 10,
          }}>{parseError}</div>
        )}

        {(matched.length > 0 || unmatched.length > 0) && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, fontSize: 12 }}>
            <span style={{ padding: '4px 10px', background: '#ecfdf5', color: '#059669', borderRadius: 6, fontWeight: 600 }}>
              {matched.length} matched
            </span>
            {unmatched.length > 0 && (
              <span style={{ padding: '4px 10px', background: '#fef3c7', color: '#a16207', borderRadius: 6, fontWeight: 600 }}>
                {unmatched.length} unmatched
              </span>
            )}
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {matched.length > 0 && (
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)' }}>
                  <th style={{ textAlign: 'left',  padding: '6px 8px' }}>SKU</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Spend ₹</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Orders</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', color: '#059669' }}>AD ₹/unit</th>
                </tr>
              </thead>
              <tbody>
                {matched.slice(0, 100).map((m, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '4px 8px' }}>{m.sku}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{m.spend.toFixed(0)}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{m.orders.toFixed(0)}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#059669', fontWeight: 600 }}>{m.adAmt}</td>
                  </tr>
                ))}
                {matched.length > 100 && (
                  <tr><td colSpan="4" style={{ padding: 8, color: 'var(--text-3)', fontSize: 11 }}>
                    + {matched.length - 100} more rows…
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
          {unmatched.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Skipped rows
              </div>
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <tbody>
                  {unmatched.slice(0, 50).map((u, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 8px' }}>{u.sku}</td>
                      <td style={{ padding: '4px 8px', color: 'var(--text-3)' }}>{u.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="form-actions" style={{ marginTop: 12 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" onClick={apply}
            disabled={matched.length === 0 || parsing}>
            Apply to {matched.length} SKU{matched.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  )
}
