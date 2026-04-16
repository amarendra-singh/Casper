import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPlatforms, getPnlReports, uploadPnlReport, deletePnlReport } from '../../api/client'
import './Flipkart.css'

const TABS = ['Reports', 'All Time P&L', 'By SKU']

const fmt = (v, d = 0) => {
  if (v == null) return '—'
  const n = Number(v)
  const abs = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
  return (n < 0 ? '-' : '') + '₹' + abs
}
const fmtN   = v => v == null ? '—' : Number(v).toLocaleString('en-IN')
const fmtPct = v => v == null ? '—' : Number(v).toFixed(1) + '%'
const parseLocalDate = s => s ? new Date(s + 'T00:00:00') : null
const fmtPeriod = (start, end) => {
  const s = parseLocalDate(start), e = parseLocalDate(end)
  if (!s || !e) return '—'
  return `${s.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} — ${e.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
}

export default function FlipkartPnL() {
  const navigate = useNavigate()
  const fileRef  = useRef(null)

  const [tab,          setTab]         = useState(0)
  const [viewMode,     setViewMode]    = useState('grid')
  const [reports,      setReports]     = useState([])
  const [flipkartId,   setFlipkartId]  = useState(null)
  const [loadingReports, setLoadingReports] = useState(true)
  const [showUpload,   setShowUpload]  = useState(false)
  const [uploading,    setUploading]   = useState(false)
  const [uploadError,  setUploadError] = useState('')
  const [file,         setFile]        = useState(null)
  const [toast,        setToast]       = useState(null)
  const [conflict,     setConflict]    = useState(null)

  useEffect(() => {
    async function init() {
      try {
        const platforms = await getPlatforms()
        const fk = platforms.find(p => p.name.toLowerCase().includes('flipkart'))
        if (fk) {
          setFlipkartId(fk.id)
          setReports(await getPnlReports(fk.id))
        }
      } catch (e) { console.error('[PnL]', e) }
      finally { setLoadingReports(false) }
    }
    init()
  }, [])

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  async function handleUpload(force = false) {
    if (!file) { setUploadError('Please select a file.'); return }
    if (!flipkartId) { setUploadError('Flipkart platform not found.'); return }
    setUploading(true); setUploadError('')
    try {
      const fd = new FormData()
      fd.append('file', file); fd.append('platform_id', flipkartId); fd.append('force', force)
      const result = await uploadPnlReport(fd)
      setReports(await getPnlReports(flipkartId))
      setShowUpload(false); setConflict(null); setFile(null)
      showToast(`Uploaded — ${result.matched_skus} SKUs matched, ${result.unmatched_skus} unmatched`)
      navigate(`/pnl/flipkart/${result.report_id}?view=pnl`)
    } catch (err) {
      if (err.response?.status === 409) { setConflict(err.response.data.detail) }
      else {
        const d = err.response?.data?.detail
        setUploadError(typeof d === 'string' ? d : Array.isArray(d) ? d.map(e => e.msg).join(' · ') : 'Upload failed.')
      }
    } finally { setUploading(false) }
  }

  function closeUpload() {
    if (uploading) return
    setShowUpload(false); setUploadError(''); setFile(null)
  }

  async function handleDelete(reportId, e) {
    e.stopPropagation()
    if (!window.confirm('Delete this report and all its data?')) return
    try {
      await deletePnlReport(reportId)
      setReports(r => r.filter(x => x.id !== reportId))
      showToast('Report deleted', 'info')
    } catch { showToast('Failed to delete', 'error') }
  }

  const lifetimeData = useMemo(() => {
    if (!reports.length) return null
    return {
      totalBS:         reports.reduce((s, r) => s + (r.bank_settlement || 0), 0),
      totalNetSales:   reports.reduce((s, r) => s + (r.net_sales || 0), 0),
      totalGross:      reports.reduce((s, r) => s + (r.gross_sales || 0), 0),
      totalNetUnits:   reports.reduce((s, r) => s + (r.net_units || 0), 0),
      totalGrossUnits: reports.reduce((s, r) => s + (r.gross_units || 0), 0),
      avgMargin:       reports.reduce((s, r) => s + (r.net_margin_pct || 0), 0) / reports.length,
      sorted:          [...reports].sort((a, b) => parseLocalDate(b.period_start) - parseLocalDate(a.period_start)),
    }
  }, [reports])

  return (
    <div className="pnl-page">

      {toast && <div className={`pnl-toast pnl-toast-${toast.type}`}>{toast.msg}</div>}

      {/* ── Header ── */}
      <div className="pnl-header">
        <div className="pnl-title-row">
          <div>
            <div className="pnl-platform-badge"><span className="pnl-fk-dot"/>Flipkart</div>
            <h1 className="pnl-title">Profit &amp; Loss</h1>
          </div>
          <button className="pnl-upload-btn" onClick={() => { setShowUpload(true); setUploadError('') }}>
            + Upload Report
          </button>
        </div>
        <div className="pnl-tabs">
          {TABS.map((t, i) => (
            <button key={t} className={`pnl-tab${tab === i ? ' active' : ''}`} onClick={() => setTab(i)}>{t}</button>
          ))}
        </div>
      </div>

      {/* ── Tab 0: Reports ── */}
      {tab === 0 && (
        <div className="pnl-body">
          {loadingReports ? (
            <div className="pnl-empty">Loading reports…</div>
          ) : reports.length === 0 ? (
            <div className="pnl-empty-state">
              <div className="pnl-empty-icon">📊</div>
              <div className="pnl-empty-title">No reports yet</div>
              <div className="pnl-empty-sub">Upload your first Flipkart P&amp;L report to get started</div>
              <button className="pnl-upload-btn" onClick={() => setShowUpload(true)}>+ Upload Report</button>
            </div>
          ) : (
            <>
              <div className="pnl-view-bar">
                <span className="pnl-report-count">{reports.length} report{reports.length !== 1 ? 's' : ''}</span>
                <div className="pnl-view-toggle">
                  <button className={`pnl-view-btn${viewMode === 'grid' ? ' active' : ''}`} onClick={() => setViewMode('grid')} title="Grid">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="0" y="0" width="6" height="6" rx="1.5" fill="currentColor"/><rect x="8" y="0" width="6" height="6" rx="1.5" fill="currentColor"/><rect x="0" y="8" width="6" height="6" rx="1.5" fill="currentColor"/><rect x="8" y="8" width="6" height="6" rx="1.5" fill="currentColor"/></svg>
                  </button>
                  <button className={`pnl-view-btn${viewMode === 'list' ? ' active' : ''}`} onClick={() => setViewMode('list')} title="List">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="0" y="1" width="14" height="2" rx="1" fill="currentColor"/><rect x="0" y="6" width="14" height="2" rx="1" fill="currentColor"/><rect x="0" y="11" width="14" height="2" rx="1" fill="currentColor"/></svg>
                  </button>
                </div>
              </div>

              {/* Grid */}
              {viewMode === 'grid' && (
                <div className="pnl-cards">
                  {reports.map(r => (
                    <div key={r.id} className="pnl-card">
                      <div className="pnl-card-top">
                        <div>
                          <div className="pnl-card-period">{fmtPeriod(r.period_start, r.period_end)}</div>
                          <div className="pnl-card-filename">{r.filename}</div>
                        </div>
                        <button className="pnl-card-del" onClick={e => handleDelete(r.id, e)}>✕</button>
                      </div>
                      <div className="pnl-card-metrics">
                        <div className="pnl-metric"><div className="pnl-metric-label">Gross Sales</div><div className="pnl-metric-val">{fmt(r.gross_sales)}</div></div>
                        <div className="pnl-metric"><div className="pnl-metric-label">Net Sales</div><div className="pnl-metric-val">{fmt(r.net_sales)}</div></div>
                        <div className="pnl-metric"><div className="pnl-metric-label">Bank Settlement</div><div className="pnl-metric-val gold">{fmt(r.bank_settlement)}</div></div>
                        <div className="pnl-metric"><div className="pnl-metric-label">Flipkart Margin</div><div className="pnl-metric-val">{fmtPct(r.net_margin_pct)}</div></div>
                      </div>
                      <div className="pnl-card-footer">
                        <span className="pnl-units">{fmtN(r.gross_units)} gross · {fmtN(r.net_units)} net units</span>
                        <div className="pnl-match-pills">
                          <span className="pnl-pill matched">{r.matched_skus} matched</span>
                          {r.unmatched_skus > 0 && <span className="pnl-pill unmatched">{r.unmatched_skus} unmatched</span>}
                        </div>
                      </div>
                      <div className="pnl-card-actions">
                        <button className="pnl-card-action-btn"
                          onClick={() => navigate(`/pnl/flipkart/${r.id}?view=fk`)}>
                          <span>📄</span> Flipkart Report
                        </button>
                        <button className="pnl-card-action-btn pnl-card-action-pnl"
                          onClick={() => navigate(`/pnl/flipkart/${r.id}?view=pnl`)}>
                          <span>📊</span> Real P&amp;L
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* List */}
              {viewMode === 'list' && (
                <div className="pnl-list">
                  <div className="pnl-list-header">
                    <div className="pnl-lh-period">Period</div>
                    <div className="pnl-lh-num">Gross Sales</div>
                    <div className="pnl-lh-num">Net Sales</div>
                    <div className="pnl-lh-num">Bank Settlement</div>
                    <div className="pnl-lh-num">Flipkart Margin</div>
                    <div className="pnl-lh-num">Units</div>
                    <div className="pnl-lh-pills">SKUs</div>
                    <div className="pnl-lh-act">Actions</div>
                  </div>
                  {reports.map(r => (
                    <div key={r.id} className="pnl-list-row">
                      <div className="pnl-lc-period">
                        <div className="pnl-lc-period-main">{fmtPeriod(r.period_start, r.period_end)}</div>
                        <div className="pnl-lc-filename">{r.filename}</div>
                      </div>
                      <div className="pnl-lc-num">{fmt(r.gross_sales)}</div>
                      <div className="pnl-lc-num">{fmt(r.net_sales)}</div>
                      <div className="pnl-lc-num gold">{fmt(r.bank_settlement)}</div>
                      <div className="pnl-lc-num">
                        <span className={`pnl-margin-badge ${(r.net_margin_pct||0) >= 70 ? 'good' : (r.net_margin_pct||0) >= 40 ? 'mid' : 'low'}`}>{fmtPct(r.net_margin_pct)}</span>
                      </div>
                      <div className="pnl-lc-num muted">{fmtN(r.gross_units)} / {fmtN(r.net_units)}</div>
                      <div className="pnl-lc-pills">
                        <span className="pnl-pill matched">{r.matched_skus}M</span>
                        {r.unmatched_skus > 0 && <span className="pnl-pill unmatched">{r.unmatched_skus}U</span>}
                      </div>
                      <div className="pnl-lc-act pnl-list-actions">
                        <button className="pnl-list-action-btn"
                          onClick={() => navigate(`/pnl/flipkart/${r.id}?view=fk`)}>📄 Report</button>
                        <button className="pnl-list-action-btn pnl-list-action-pnl"
                          onClick={() => navigate(`/pnl/flipkart/${r.id}?view=pnl`)}>📊 P&amp;L</button>
                        <button className="pnl-card-del" onClick={e => handleDelete(r.id, e)}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Tab 1: All Time P&L ── */}
      {tab === 1 && (
        <div className="pnl-body pnl-animate-in">
          {!lifetimeData ? (
            <div className="pnl-empty-state">
              <div className="pnl-empty-icon">📊</div>
              <div className="pnl-empty-title">No reports yet</div>
              <div className="pnl-empty-sub">Upload reports to see lifetime P&amp;L</div>
              <button className="pnl-btn-ghost" onClick={() => setTab(0)}>← Go to Reports</button>
            </div>
          ) : (
            <div className="pnl-animate-in">
              <div className="pnl-lt-kpis">
                <div className="pnl-lt-kpi">
                  <div className="pnl-lt-kpi-label">Total Bank Settlement</div>
                  <div className="pnl-lt-kpi-val gold">{fmt(lifetimeData.totalBS)}</div>
                  <div className="pnl-lt-kpi-sub">Across {reports.length} report{reports.length !== 1 ? 's' : ''}</div>
                </div>
                <div className="pnl-lt-kpi">
                  <div className="pnl-lt-kpi-label">Total Net Sales</div>
                  <div className="pnl-lt-kpi-val">{fmt(lifetimeData.totalNetSales)}</div>
                  <div className="pnl-lt-kpi-sub">After all returns</div>
                </div>
                <div className="pnl-lt-kpi">
                  <div className="pnl-lt-kpi-label">Total Units Delivered</div>
                  <div className="pnl-lt-kpi-val">{fmtN(lifetimeData.totalNetUnits)}</div>
                  <div className="pnl-lt-kpi-sub">of {fmtN(lifetimeData.totalGrossUnits)} ordered</div>
                </div>
                <div className="pnl-lt-kpi">
                  <div className="pnl-lt-kpi-label">Avg Flipkart Margin</div>
                  <div className="pnl-lt-kpi-val">{fmtPct(lifetimeData.avgMargin)}</div>
                  <div className="pnl-lt-kpi-sub">After Flipkart fees only</div>
                </div>
              </div>

              <div className="pnl-lt-section">
                <div className="pnl-lt-section-title">Period Breakdown</div>
                <div className="pnl-tbl-wrap" style={{ flex: 'none' }}>
                  <table className="pnl-tbl">
                    <thead>
                      <tr>
                        <th className="pnl-th">Period</th>
                        <th className="pnl-th" style={{ textAlign: 'right' }}>Gross Sales</th>
                        <th className="pnl-th" style={{ textAlign: 'right' }}>Net Sales</th>
                        <th className="pnl-th" style={{ textAlign: 'right' }}>Bank Settlement</th>
                        <th className="pnl-th" style={{ textAlign: 'right' }}>Flipkart Margin</th>
                        <th className="pnl-th" style={{ textAlign: 'right' }}>Gross Units</th>
                        <th className="pnl-th" style={{ textAlign: 'right' }}>Net Units</th>
                        <th className="pnl-th" style={{ textAlign: 'center' }}>SKUs</th>
                        <th className="pnl-th" style={{ textAlign: 'center' }}>Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lifetimeData.sorted.map(r => (
                        <tr key={r.id} className="pnl-tr pnl-lt-row">
                          <td className="pnl-td"><div className="pnl-lt-period">{fmtPeriod(r.period_start, r.period_end)}</div></td>
                          <td className="pnl-td right mono">{fmt(r.gross_sales)}</td>
                          <td className="pnl-td right mono">{fmt(r.net_sales)}</td>
                          <td className="pnl-td right mono gold">{fmt(r.bank_settlement)}</td>
                          <td className="pnl-td center">
                            <span className={`pnl-margin-badge ${(r.net_margin_pct||0) >= 70 ? 'good' : (r.net_margin_pct||0) >= 40 ? 'mid' : 'low'}`}>{fmtPct(r.net_margin_pct)}</span>
                          </td>
                          <td className="pnl-td right mono muted">{fmtN(r.gross_units)}</td>
                          <td className="pnl-td right mono">{fmtN(r.net_units)}</td>
                          <td className="pnl-td center">
                            <span className="pnl-pill matched">{r.matched_skus}M</span>
                            {r.unmatched_skus > 0 && <span className="pnl-pill unmatched" style={{ marginLeft: 4 }}>{r.unmatched_skus}U</span>}
                          </td>
                          <td className="pnl-td center">
                            <div className="pnl-lt-btns">
                              <button className="pnl-lt-open-btn" title="Flipkart Report"
                                onClick={() => navigate(`/pnl/flipkart/${r.id}?view=fk`)}>📄</button>
                              <button className="pnl-lt-open-btn pnl-lt-open-pnl" title="Real P&L"
                                onClick={() => navigate(`/pnl/flipkart/${r.id}?view=pnl`)}>📊</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="pnl-lt-totals">
                        <td className="pnl-td pnl-lt-total-label">Total</td>
                        <td className="pnl-td right mono">{fmt(lifetimeData.totalGross)}</td>
                        <td className="pnl-td right mono">{fmt(lifetimeData.totalNetSales)}</td>
                        <td className="pnl-td right mono gold">{fmt(lifetimeData.totalBS)}</td>
                        <td className="pnl-td center">
                          <span className={`pnl-margin-badge ${lifetimeData.avgMargin >= 70 ? 'good' : lifetimeData.avgMargin >= 40 ? 'mid' : 'low'}`}>{fmtPct(lifetimeData.avgMargin)} avg</span>
                        </td>
                        <td className="pnl-td right mono muted">{fmtN(lifetimeData.totalGrossUnits)}</td>
                        <td className="pnl-td right mono">{fmtN(lifetimeData.totalNetUnits)}</td>
                        <td className="pnl-td center">—</td>
                        <td className="pnl-td center">—</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab 2: By SKU ── */}
      {tab === 2 && (
        <div className="pnl-body pnl-animate-in pnl-empty-state">
          <div className="pnl-empty-icon">🔬</div>
          <div className="pnl-empty-title">Lifetime By SKU</div>
          <div className="pnl-empty-sub">Cross-report SKU performance — coming soon</div>
        </div>
      )}

      {/* ── Upload modal ── */}
      {showUpload && !conflict && (
        <div className="pnl-modal-overlay" onClick={closeUpload}>
          <div className="pnl-modal" onClick={e => e.stopPropagation()}>
            <div className="pnl-modal-hdr">
              <span>Upload Flipkart P&amp;L Report</span>
              <button className="pnl-modal-close" onClick={closeUpload}>✕</button>
            </div>
            <div className="pnl-modal-body">
              <div className="pnl-period-note">📅 Period will be auto-detected from the report file.</div>
              <div className="pnl-field">
                <label className="pnl-label">Excel File (.xlsx / .xls)</label>
                <div className={`pnl-dropzone${file ? ' has-file' : ''}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f) }}>
                  {file ? (
                    <>
                      <span className="pnl-file-icon">📄</span>
                      <span className="pnl-file-name">{file.name}</span>
                      <button className="pnl-file-clear" onClick={e => { e.stopPropagation(); setFile(null) }}>✕ Clear</button>
                    </>
                  ) : (
                    <>
                      <span className="pnl-drop-icon">⬆</span>
                      <span>Drop file here or click to browse</span>
                      <span className="pnl-drop-hint">Flipkart Profit &amp; Loss .xlsx</span>
                    </>
                  )}
                  <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                    onChange={e => setFile(e.target.files[0])} />
                </div>
              </div>
              {uploadError && <div className="pnl-error">{uploadError}</div>}
            </div>
            <div className="pnl-modal-footer">
              <button className="pnl-btn-ghost" onClick={closeUpload} disabled={uploading}>Cancel</button>
              <button className="pnl-btn-primary" onClick={() => handleUpload(false)} disabled={uploading || !file}>
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Conflict modal ── */}
      {conflict && (
        <div className="pnl-modal-overlay" onClick={() => !uploading && setConflict(null)}>
          <div className="pnl-modal" onClick={e => e.stopPropagation()}>
            <div className="pnl-modal-hdr"><span>⚠ Duplicate Report Detected</span></div>
            <div className="pnl-modal-body">
              <div className="pnl-conflict-info">
                <div>A report for this period already exists:</div>
                <div className="pnl-conflict-detail">
                  <div><b>Period:</b> {conflict.period_start} → {conflict.period_end}</div>
                  <div><b>Uploaded:</b> {new Date(conflict.uploaded_at).toLocaleString('en-IN')}</div>
                  <div><b>File:</b> {conflict.filename}</div>
                </div>
                <div className="pnl-conflict-warn">Replacing will permanently delete the existing report and all its data.</div>
              </div>
            </div>
            <div className="pnl-modal-footer">
              <button className="pnl-btn-ghost" onClick={() => setConflict(null)}>Keep Existing</button>
              <button className="pnl-btn-danger" onClick={() => { setConflict(null); handleUpload(true) }} disabled={uploading}>
                {uploading ? 'Replacing…' : 'Replace'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
