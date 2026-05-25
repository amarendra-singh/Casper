import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
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

const PLATFORM_COLORS = {
  flipkart:  '#F9A825',
  meesho:    '#9C27B0',
  snapdeal:  '#E53935',
  amazon:    '#FF9900',
}

export default function PnLList() {
  const { platform }  = useParams()
  const navigate      = useNavigate()
  const fileRef       = useRef(null)

  const platformKey   = (platform || '').toLowerCase()
  const dotColor      = PLATFORM_COLORS[platformKey] || '#6B7280'
  const capitalize    = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s

  const [tab,            setTab]           = useState(0)
  const [viewMode,       setViewMode]      = useState('grid')
  const [reports,        setReports]       = useState([])
  const [platformId,     setPlatformId]    = useState(null)
  const [platformName,   setPlatformName]  = useState(capitalize(platform || ''))
  const [loadingReports, setLoadingReports] = useState(true)
  const [showUpload,     setShowUpload]    = useState(false)
  const [uploading,      setUploading]     = useState(false)
  const [uploadError,    setUploadError]   = useState('')
  const [file,           setFile]          = useState(null)
  const [toast,          setToast]         = useState(null)
  const [conflict,       setConflict]      = useState(null)
  const [uploadResult,   setUploadResult]  = useState(null)   // holds result when parse warnings exist

  useEffect(() => {
    setTab(0)
    setReports([])
    setLoadingReports(true)
    setPlatformId(null)

    async function init() {
      try {
        const platforms = await getPlatforms()
        const found = platforms.find(p => p.name.toLowerCase() === platformKey)
        if (found) {
          setPlatformId(found.id)
          setPlatformName(found.name)
          setReports(await getPnlReports(found.id))
        }
      } catch (e) { console.error('[PnL]', e) }
      finally { setLoadingReports(false) }
    }
    init()
  }, [platformKey])

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  async function handleUpload(force = false) {
    if (!file)       { setUploadError('Please select a file.'); return }
    if (!platformId) { setUploadError(`${platformName} platform not found.`); return }
    setUploading(true); setUploadError('')
    try {
      const fd = new FormData()
      fd.append('file', file); fd.append('platform_id', platformId); fd.append('force', force)
      const result = await uploadPnlReport(fd)
      setReports(await getPnlReports(platformId))
      setConflict(null); setFile(null)
      if (result.parse_warnings?.length > 0) {
        // Stay in modal, show warnings — user must acknowledge before navigating
        setUploadResult(result)
      } else {
        setShowUpload(false)
        showToast(`Uploaded — ${result.matched_skus} matched, ${result.unmatched_skus} unmatched`)
        navigate(`/pnl/${platformKey}/${result.report_id}?view=pnl`)
      }
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
    setShowUpload(false); setUploadError(''); setFile(null); setUploadResult(null)
  }

  function goToUploadResult() {
    const r = uploadResult
    setShowUpload(false); setUploadResult(null)
    showToast(`Uploaded — ${r.matched_skus} matched, ${r.unmatched_skus} unmatched`, 'success')
    navigate(`/pnl/${platformKey}/${r.report_id}?view=pnl`)
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
            <div className="pnl-platform-badge">
              <span className="pnl-fk-dot" style={{ background: dotColor }} />
              {platformName}
            </div>
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
              <div className="pnl-empty-icon">
                <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><rect x="5" y="5" width="30" height="30" rx="4"/><path d="M12 28v-8M20 28V15M28 28v-5"/></svg>
              </div>
              <div className="pnl-empty-title">No reports yet</div>
              <div className="pnl-empty-sub">Upload your first {platformName} P&amp;L report to get started</div>
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
                        <div className="pnl-metric"><div className="pnl-metric-label">{platformName} Margin</div><div className="pnl-metric-val">{fmtPct(r.net_margin_pct)}</div></div>
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
                          onClick={() => navigate(`/pnl/${platformKey}/${r.id}?view=overview`)}>
                          {platformName} Report
                        </button>
                        <button className="pnl-card-action-btn pnl-card-action-pnl"
                          onClick={() => navigate(`/pnl/${platformKey}/${r.id}?view=pnl`)}>
                          Real P&amp;L
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
                    <div className="pnl-lh-num">{platformName} Margin</div>
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
                        {r.unmatched_skus > 0 && <span className="pnl-pill unmatched" style={{ marginLeft: 4 }}>{r.unmatched_skus}U</span>}
                      </div>
                      <div className="pnl-lc-act pnl-list-actions">
                        <button className="pnl-list-action-btn"
                          onClick={() => navigate(`/pnl/${platformKey}/${r.id}?view=overview`)}>Report</button>
                        <button className="pnl-list-action-btn pnl-list-action-pnl"
                          onClick={() => navigate(`/pnl/${platformKey}/${r.id}?view=pnl`)}>P&amp;L</button>
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
              <div className="pnl-empty-icon">
                <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><rect x="5" y="5" width="30" height="30" rx="4"/><path d="M12 28v-8M20 28V15M28 28v-5"/></svg>
              </div>
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
                  <div className="pnl-lt-kpi-label">Avg {platformName} Margin</div>
                  <div className="pnl-lt-kpi-val">{fmtPct(lifetimeData.avgMargin)}</div>
                  <div className="pnl-lt-kpi-sub">After {platformName} fees only</div>
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
                        <th className="pnl-th" style={{ textAlign: 'right' }}>{platformName} Margin</th>
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
                              <button className="pnl-lt-open-btn" title={`${platformName} Report`}
                                onClick={() => navigate(`/pnl/${platformKey}/${r.id}?view=overview`)}>↗</button>
                              <button className="pnl-lt-open-btn pnl-lt-open-pnl" title="Unit Economics"
                                onClick={() => navigate(`/pnl/${platformKey}/${r.id}?view=pnl`)}>P&L</button>
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
          <div className="pnl-empty-icon">
            <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="20" cy="20" r="14"/><path d="M20 13v7l5 3"/></svg>
          </div>
          <div className="pnl-empty-title">Lifetime By SKU</div>
          <div className="pnl-empty-sub">Cross-report SKU performance — coming soon</div>
        </div>
      )}

      {/* ── Upload modal ── */}
      {showUpload && !conflict && (
        <div className="pnl-modal-overlay" onClick={closeUpload}>
          <div className="pnl-modal" onClick={e => e.stopPropagation()}>
            <div className="pnl-modal-hdr">
              <span>Upload {platformName} P&amp;L Report</span>
              <button className="pnl-modal-close" onClick={closeUpload}>✕</button>
            </div>
            <div className="pnl-modal-body">
              <div className="pnl-period-note">Period will be auto-detected from the report file.</div>
              <div className="pnl-field">
                <label className="pnl-label">Excel File (.xlsx / .xls)</label>
                <div className={`pnl-dropzone${file ? ' has-file' : ''}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f) }}>
                  {file ? (
                    <>
                      <span className="pnl-file-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      </span>
                      <span className="pnl-file-name">{file.name}</span>
                      <button className="pnl-file-clear" onClick={e => { e.stopPropagation(); setFile(null) }}>✕ Clear</button>
                    </>
                  ) : (
                    <>
                      <span className="pnl-drop-icon">⬆</span>
                      <span>Drop file here or click to browse</span>
                      <span className="pnl-drop-hint">{platformName} P&amp;L .xlsx</span>
                    </>
                  )}
                  <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                    onChange={e => setFile(e.target.files[0])} />
                </div>
              </div>
              {uploadError && <div className="pnl-error">{uploadError}</div>}

              {/* Parse warnings — shown after upload if critical fields have >30% nulls */}
              {uploadResult?.parse_warnings?.length > 0 && (
                <div className="pnl-parse-warnings">
                  <div className="pnl-warn-head">
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2L1 17h18L10 2zm0 3l6.5 11H3.5L10 5zm-1 4v3h2V9H9zm0 4v2h2v-2H9z"/></svg>
                    Upload successful — {uploadResult.matched_skus} matched · {uploadResult.unmatched_skus} unmatched
                  </div>
                  <div className="pnl-warn-title">⚠ Data quality issues detected</div>
                  {uploadResult.parse_warnings.map((w, i) => (
                    <div key={i} className="pnl-warn-item">• {w}</div>
                  ))}
                  <div className="pnl-warn-note">These fields may affect P&L accuracy. Check the parser or re-upload a corrected file.</div>
                </div>
              )}
            </div>
            <div className="pnl-modal-footer">
              {uploadResult ? (
                <>
                  <button className="pnl-btn-ghost" onClick={closeUpload}>Close</button>
                  <button className="pnl-btn-primary" onClick={goToUploadResult}>View Report →</button>
                </>
              ) : (
                <>
                  <button className="pnl-btn-ghost" onClick={closeUpload} disabled={uploading}>Cancel</button>
                  <button className="pnl-btn-primary" onClick={() => handleUpload(false)} disabled={uploading || !file}>
                    {uploading ? 'Uploading…' : 'Upload'}
                  </button>
                </>
              )}
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
