import { useState, useEffect, useRef, useMemo } from 'react'
import { getPlatforms, getPnlReports, getPnlReport, uploadPnlReport, deletePnlReport } from '../../api/client'
import './Flipkart.css'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const TABS = ['Reports', 'Profit & Loss', 'Insights']

const fmt    = (v, d = 0) => v == null ? '—' : '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtN   = v => v == null ? '—' : Number(v).toLocaleString('en-IN')
const fmtPct = v => v == null ? '—' : Number(v).toFixed(1) + '%'
const parseLocalDate = s => s ? new Date(s + 'T00:00:00') : null
const fmtPeriod = (start, end) => {
  const s = parseLocalDate(start), e = parseLocalDate(end)
  if (!s || !e) return '—'
  return `${s.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} — ${e.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
}
const fmtExpectedMargin = v => (v == null || v < 0 || v > 200) ? '—' : fmtPct(v)

export default function FlipkartPnL() {
  const [tab, setTab]               = useState(0)
  const [viewMode, setViewMode]     = useState('grid')
  const [reports, setReports]       = useState([])
  const [selectedReport, setSelectedReport] = useState(null)
  const [loadingReports, setLoadingReports] = useState(true)
  const [loadingDetail, setLoadingDetail]   = useState(false)
  const [flipkartId, setFlipkartId] = useState(null)
  const [showUpload, setShowUpload] = useState(false)
  const [uploading, setUploading]   = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [file, setFile]             = useState(null)
  const [toast, setToast]           = useState(null)
  const fileRef = useRef(null)
  const [conflict, setConflict]     = useState(null)
  const [pnlView, setPnlView]       = useState('lifetime')   // 'lifetime' | 'bysku' | 'report'
  const [reportView, setReportView] = useState('fk')          // 'fk' | 'pnl'
  const [skuFilter, setSkuFilter]   = useState('all')
  const [skuSearch, setSkuSearch]   = useState('')
  const [sortCol, setSortCol]       = useState('variance_bs')
  const [sortDir, setSortDir]       = useState('asc')

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

  async function loadDetail(reportId, view = 'fk') {
    setLoadingDetail(true)
    setReportView(view)
    try {
      const data = await getPnlReport(reportId)
      setSelectedReport(data)
      setTab(1)
      setPnlView('report')
    } catch (e) { console.error('[PnL]', e) }
    finally { setLoadingDetail(false) }
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
      await loadDetail(result.report_id, 'fk')
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
      if (selectedReport?.id === reportId) { setSelectedReport(null); setTab(0) }
      showToast('Report deleted', 'info')
    } catch { showToast('Failed to delete', 'error') }
  }

  const skuRows = selectedReport?.sku_rows || []
  const filteredRows = skuRows
    .filter(r => {
      if (skuFilter === 'matched')   return r.is_matched
      if (skuFilter === 'unmatched') return !r.is_matched
      if (skuFilter === 'beating')   return r.is_matched && (r.variance_bs || 0) > 0
      if (skuFilter === 'missing')   return r.is_matched && (r.variance_bs || 0) < 0
      return true
    })
    .filter(r => !skuSearch || r.platform_sku_name.toLowerCase().includes(skuSearch.toLowerCase()))
    .sort((a, b) => {
      const av = a[sortCol] ?? (sortDir === 'asc' ? Infinity : -Infinity)
      const bv = b[sortCol] ?? (sortDir === 'asc' ? Infinity : -Infinity)
      return sortDir === 'asc' ? av - bv : bv - av
    })

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }
  const sortIcon = col => sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  const insightsData = useMemo(() => {
    if (!selectedReport) return null
    const rows    = selectedReport.sku_rows || []
    const matched = rows.filter(r => r.is_matched && r.variance_bs != null)
    const totalActualBS   = matched.reduce((s, r) => s + (r.bank_settlement_projected || 0), 0)
    const totalExpectedBS = matched.reduce((s, r) => s + (r.casper_expected_bs || 0) * (r.net_units || 0), 0)
    const netVariance     = totalActualBS - totalExpectedBS
    const totalRevShipping = rows.reduce((s, r) => s + Math.abs(r.reverse_shipping_fee || 0), 0)
    const totalCommission  = rows.reduce((s, r) => s + Math.abs(r.commission_fee || 0), 0)
    const totalCollection  = rows.reduce((s, r) => s + Math.abs(r.collection_fee || 0), 0)
    const totalGST         = rows.reduce((s, r) => s + Math.abs(r.taxes_gst || 0), 0)
    const totalTax         = rows.reduce((s, r) => s + Math.abs(r.taxes_tcs || 0) + Math.abs(r.taxes_tds || 0), 0)
    const totalRewards     = rows.reduce((s, r) => s + (r.rewards_benefits || 0), 0)
    const totalRTO         = rows.reduce((s, r) => s + (r.rto_units || 0), 0)
    const totalRVP         = rows.reduce((s, r) => s + (r.rvp_units || 0), 0)
    const totalCancelled   = rows.reduce((s, r) => s + (r.cancelled_units || 0), 0)
    const sortedByVar      = [...matched].sort((a, b) => b.variance_bs - a.variance_bs)
    const varianceChartData = [
      ...sortedByVar.filter(r => r.variance_bs < 0).slice(-6),
      ...sortedByVar.filter(r => r.variance_bs > 0).slice(0, 6),
    ].map(r => ({ name: r.platform_sku_name.split('-').slice(-2).join('-'), fullName: r.platform_sku_name, variance: Math.round(r.variance_bs) }))
    const marginBrackets = [
      { label: 'Loss',   count: rows.filter(r => (r.net_margin_pct||0) < 0).length,                                   color: '#ef4444' },
      { label: '0–20%',  count: rows.filter(r => (r.net_margin_pct||0) >= 0  && (r.net_margin_pct||0) < 20).length,  color: '#f97316' },
      { label: '20–50%', count: rows.filter(r => (r.net_margin_pct||0) >= 20 && (r.net_margin_pct||0) < 50).length,  color: '#eab308' },
      { label: '50–80%', count: rows.filter(r => (r.net_margin_pct||0) >= 50 && (r.net_margin_pct||0) < 80).length,  color: '#22c55e' },
      { label: '80%+',   count: rows.filter(r => (r.net_margin_pct||0) >= 80).length,                                  color: '#16a34a' },
    ]
    const beatingSkus = matched.filter(r => r.variance_bs > 0)
    const missingSkus = matched.filter(r => r.variance_bs < 0)
    return {
      totalActualBS, totalExpectedBS, netVariance,
      totalRevShipping, totalCommission, totalCollection, totalGST, totalTax, totalRewards,
      totalRTO, totalRVP, totalCancelled, varianceChartData, marginBrackets,
      beatingCount: beatingSkus.length, missingCount: missingSkus.length,
      beatingTotal: beatingSkus.reduce((s, r) => s + r.variance_bs, 0),
      missingTotal: missingSkus.reduce((s, r) => s + r.variance_bs, 0),
    }
  }, [selectedReport])

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
          <button className="pnl-upload-btn" onClick={() => { setShowUpload(true); setUploadError('') }}>+ Upload Report</button>
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
                        <button className="pnl-card-action-btn" onClick={() => loadDetail(r.id, 'fk')} disabled={loadingDetail}>
                          <span>📄</span> Flipkart Report
                        </button>
                        <button className="pnl-card-action-btn pnl-card-action-pnl" onClick={() => loadDetail(r.id, 'pnl')} disabled={loadingDetail}>
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
                        <button className="pnl-list-action-btn" onClick={() => loadDetail(r.id, 'fk')} disabled={loadingDetail}>📄 Report</button>
                        <button className="pnl-list-action-btn pnl-list-action-pnl" onClick={() => loadDetail(r.id, 'pnl')} disabled={loadingDetail}>📊 P&amp;L</button>
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

      {/* ── Tab 1: Profit & Loss ── */}
      {tab === 1 && (
        <div className={`pnl-body ${pnlView === 'report' ? 'pnl-body-full' : ''} pnl-animate-in`}>

          {/* Glass toggle */}
          <div className="pnl-pnl-toolbar">
            <div className="pnl-toggle-glass">
              <button className={`pnl-toggle-btn${pnlView === 'lifetime' ? ' active' : ''}`} onClick={() => setPnlView('lifetime')}>All Time</button>
              <button className={`pnl-toggle-btn${pnlView === 'bysku' ? ' active' : ''}`} onClick={() => setPnlView('bysku')}>By SKU</button>
              {reports.length > 0 && <div className="pnl-toggle-divider"/>}
              {[...reports].sort((a, b) => parseLocalDate(b.period_start) - parseLocalDate(a.period_start)).map(r => {
                const isActive = pnlView === 'report' && selectedReport?.id === r.id
                const label = parseLocalDate(r.period_start)?.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
                return (
                  <button key={r.id} className={`pnl-toggle-btn${isActive ? ' active' : ''}`}
                    onClick={() => loadDetail(r.id, reportView)}>
                    {loadingDetail && isActive ? '…' : label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Report view */}
          {pnlView === 'report' && (
            loadingDetail ? (
              <div className="pnl-empty">Loading…</div>
            ) : !selectedReport ? (
              <div className="pnl-empty-state">
                <div className="pnl-empty-icon">📋</div>
                <div className="pnl-empty-title">Select a month</div>
                <div className="pnl-empty-sub">Click a month pill above to view its breakdown</div>
              </div>
            ) : (
              <div className="pnl-animate-in" key={selectedReport.id}>

                {/* Sub-view switcher */}
                <div className="pnl-report-view-switcher">
                  <button className={`pnl-rv-btn${reportView === 'fk' ? ' active' : ''}`} onClick={() => setReportView('fk')}>
                    <span>📄</span> Flipkart Report
                  </button>
                  <button className={`pnl-rv-btn${reportView === 'pnl' ? ' active' : ''}`} onClick={() => setReportView('pnl')}>
                    <span>📊</span> Real P&amp;L
                  </button>
                  <div className="pnl-rv-period">{fmtPeriod(selectedReport.period_start, selectedReport.period_end)}</div>
                </div>

                {/* ── Flipkart Report sub-view ── */}
                {reportView === 'fk' && (
                  <div className="pnl-fk-report pnl-animate-in">

                    <div className="pnl-fk-section-title">Revenue Flow</div>
                    <div className="pnl-fk-panels">

                      <div className="pnl-fk-panel">
                        <div className="pnl-fk-panel-title">Sales</div>
                        <div className="pnl-fk-rows">
                          <div className="pnl-fk-row base"><span>Gross Sales</span><span>{fmt(selectedReport.gross_sales)}</span></div>
                          <div className="pnl-fk-row cost"><span>Returns Deducted</span><span>−{fmt(Math.abs(selectedReport.returns_amount || 0))}</span></div>
                          <div className="pnl-fk-row result"><span>Net Sales</span><span>{fmt(selectedReport.net_sales)}</span></div>
                        </div>
                      </div>

                      <div className="pnl-fk-panel">
                        <div className="pnl-fk-panel-title">Flipkart Fees</div>
                        <div className="pnl-fk-rows">
                          {insightsData && [
                            { label: 'Reverse Shipping',  value: insightsData.totalRevShipping, neg: true  },
                            { label: 'Commission',        value: insightsData.totalCommission,  neg: true  },
                            { label: 'Collection Fee',    value: insightsData.totalCollection,  neg: true  },
                            { label: 'GST on Fees',       value: insightsData.totalGST,         neg: true  },
                            { label: 'TCS / TDS',         value: insightsData.totalTax,         neg: true  },
                            { label: 'Rewards / Benefits',value: insightsData.totalRewards,     neg: false },
                            { label: 'Total Expenses',    value: selectedReport.total_expenses, neg: true, bold: true },
                          ].filter(x => x.value != null && x.value !== 0).map((item, i) => (
                            <div key={i} className={`pnl-fk-row ${item.bold ? 'result' : item.neg ? 'cost' : 'benefit'}`}>
                              <span>{item.label}</span>
                              <span>{item.neg ? '−' : '+'}{fmt(Math.abs(item.value))}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="pnl-fk-panel">
                        <div className="pnl-fk-panel-title">Settlement</div>
                        <div className="pnl-fk-rows">
                          <div className="pnl-fk-row base"><span>Net Earnings</span><span>{fmt(selectedReport.net_earnings)}</span></div>
                          <div className="pnl-fk-row base"><span>Input Tax Credits</span><span>{fmt(selectedReport.input_tax_credits)}</span></div>
                          <div className="pnl-fk-row result gold"><span>Bank Settlement</span><span>{fmt(selectedReport.bank_settlement)}</span></div>
                          <div className="pnl-fk-row benefit"><span>Amount Settled</span><span>{fmt(selectedReport.amount_settled)}</span></div>
                          {(selectedReport.amount_pending || 0) !== 0 && (
                            <div className="pnl-fk-row cost"><span>Amount Pending</span><span>{fmt(selectedReport.amount_pending)}</span></div>
                          )}
                          <div className="pnl-fk-row result"><span>Flipkart Margin</span><span>{fmtPct(selectedReport.net_margin_pct)}</span></div>
                        </div>
                      </div>

                    </div>

                    <div className="pnl-fk-section-title" style={{ marginTop: 24 }}>Unit Flow</div>
                    <div className="pnl-fk-units">
                      {[
                        { label: 'Gross Orders',  value: selectedReport.gross_units,        cls: 'base',   icon: '📦' },
                        { label: 'RTO',           value: insightsData?.totalRTO || 0,       cls: 'cost',   icon: '↩' },
                        { label: 'RVP',           value: insightsData?.totalRVP || 0,       cls: 'cost',   icon: '↩' },
                        { label: 'Cancelled',     value: insightsData?.totalCancelled || 0, cls: 'cost',   icon: '✕' },
                        { label: 'Net Delivered', value: selectedReport.net_units,          cls: 'result', icon: '✓' },
                      ].map((item, i) => (
                        <div key={i} className={`pnl-fk-unit-card pnl-fk-unit-${item.cls}`}>
                          <div className="pnl-fku-icon">{item.icon}</div>
                          <div className="pnl-fku-num">{fmtN(item.value)}</div>
                          <div className="pnl-fku-label">{item.label}</div>
                          <div className="pnl-fku-pct">{((item.value / (selectedReport.gross_units || 1)) * 100).toFixed(1)}%</div>
                        </div>
                      ))}
                    </div>

                    <div className="pnl-fk-section-title" style={{ marginTop: 24 }}>SKU Summary</div>
                    <div className="pnl-fk-sku-summary">
                      <div className="pnl-fk-sku-stat">
                        <div className="pnl-fk-sku-num">{selectedReport.total_skus}</div>
                        <div className="pnl-fk-sku-lbl">Total SKUs</div>
                      </div>
                      <div className="pnl-fk-sku-stat green">
                        <div className="pnl-fk-sku-num">{selectedReport.matched_skus}</div>
                        <div className="pnl-fk-sku-lbl">Matched to pricing</div>
                      </div>
                      {selectedReport.unmatched_skus > 0 && (
                        <div className="pnl-fk-sku-stat amber">
                          <div className="pnl-fk-sku-num">{selectedReport.unmatched_skus}</div>
                          <div className="pnl-fk-sku-lbl">No pricing data</div>
                        </div>
                      )}
                      <button className="pnl-fk-switch-btn" onClick={() => setReportView('pnl')}>
                        View Real P&amp;L → SKU Breakdown
                      </button>
                    </div>

                  </div>
                )}

                {/* ── Real P&L sub-view ── */}
                {reportView === 'pnl' && (
                  <div className="pnl-animate-in">

                    <div className="pnl-summary-bar">
                      <div className="pnl-sum-item"><div className="pnl-sum-label">Bank Settlement</div><div className="pnl-sum-val gold">{fmt(selectedReport.bank_settlement)}</div></div>
                      <div className="pnl-sum-divider"/>
                      <div className="pnl-sum-item"><div className="pnl-sum-label">Flipkart Margin</div><div className="pnl-sum-val">{fmtPct(selectedReport.net_margin_pct)}</div></div>
                      <div className="pnl-sum-item"><div className="pnl-sum-label">Net Units</div><div className="pnl-sum-val">{fmtN(selectedReport.net_units)}</div></div>
                      <div className="pnl-sum-item"><div className="pnl-sum-label">Returns</div><div className="pnl-sum-val red">{fmtN(selectedReport.returned_units)} units</div></div>
                      {insightsData && <>
                        <div className="pnl-sum-divider"/>
                        <div className="pnl-sum-item">
                          <div className="pnl-sum-label">P&amp;L Signal</div>
                          <div className={`pnl-sum-val ${insightsData.netVariance >= 0 ? 'green' : 'red'}`}>
                            {insightsData.netVariance >= 0 ? '+' : ''}{fmt(insightsData.netVariance)}
                          </div>
                        </div>
                        <div className="pnl-sum-item"><div className="pnl-sum-label">Beating Target</div><div className="pnl-sum-val green">{insightsData.beatingCount} SKUs</div></div>
                        <div className="pnl-sum-item"><div className="pnl-sum-label">Below Target</div><div className="pnl-sum-val red">{insightsData.missingCount} SKUs</div></div>
                      </>}
                    </div>

                    <div className="pnl-tbl-controls">
                      <input className="pnl-search" placeholder="Search SKU…" value={skuSearch} onChange={e => setSkuSearch(e.target.value)} />
                      <div className="pnl-filter-pills">
                        {[
                          { key: 'all',       label: `All (${skuRows.length})` },
                          { key: 'beating',   label: `Beating (${insightsData?.beatingCount || 0})` },
                          { key: 'missing',   label: `Below Target (${insightsData?.missingCount || 0})` },
                          { key: 'unmatched', label: `No Data (${selectedReport.unmatched_skus})` },
                        ].map(f => (
                          <button key={f.key} className={`pnl-fpill${skuFilter === f.key ? ' active' : ''}`} onClick={() => setSkuFilter(f.key)}>{f.label}</button>
                        ))}
                      </div>
                      <span className="pnl-row-count">{filteredRows.length} SKUs</span>
                    </div>

                    <div className="pnl-tbl-wrap">
                      <table className="pnl-tbl">
                        <thead>
                          <tr>
                            <th className="pnl-th sticky-col">SKU</th>
                            <th className="pnl-th sortable" onClick={() => toggleSort('net_units')}>Net Units{sortIcon('net_units')}</th>
                            <th className="pnl-th sortable" onClick={() => toggleSort('return_rate_pct')}>Return Rate{sortIcon('return_rate_pct')}</th>
                            <th className="pnl-th sortable" onClick={() => toggleSort('bank_settlement_projected')}>Actual BS{sortIcon('bank_settlement_projected')}</th>
                            <th className="pnl-th">Expected BS</th>
                            <th className="pnl-th sortable pnl-th-primary" onClick={() => toggleSort('variance_bs')}>Variance{sortIcon('variance_bs')}</th>
                            <th className="pnl-th sortable" onClick={() => toggleSort('net_margin_pct')}>Flipkart Margin{sortIcon('net_margin_pct')}</th>
                            <th className="pnl-th">Target Margin</th>
                            <th className="pnl-th sortable" onClick={() => toggleSort('earnings_per_unit')}>EPU{sortIcon('earnings_per_unit')}</th>
                            <th className="pnl-th sortable" onClick={() => toggleSort('reverse_shipping_fee')}>Rev. Ship{sortIcon('reverse_shipping_fee')}</th>
                            <th className="pnl-th">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredRows.map(row => {
                            const varBs    = row.variance_bs
                            const varClass = varBs == null ? '' : varBs >= 0 ? 'positive' : 'negative'
                            const expectedTotal = row.casper_expected_bs != null && row.net_units != null
                              ? row.casper_expected_bs * row.net_units : null
                            return (
                              <tr key={row.id} className={`pnl-tr${!row.is_matched ? ' unmatched-row' : ''}`}>
                                <td className="pnl-td sku-col sticky-col"><span className="pnl-sku-name">{row.platform_sku_name}</span></td>
                                <td className="pnl-td center">{fmtN(row.net_units)}</td>
                                <td className="pnl-td center">
                                  {row.return_rate_pct != null
                                    ? <span className={`pnl-ret-rate ${row.return_rate_pct > 40 ? 'high' : row.return_rate_pct > 20 ? 'mid' : 'low'}`}>{fmtPct(row.return_rate_pct)}</span>
                                    : '—'}
                                </td>
                                <td className="pnl-td right mono">{fmt(row.bank_settlement_projected, 2)}</td>
                                <td className="pnl-td right mono muted">{fmt(expectedTotal, 2)}</td>
                                <td className={`pnl-td right mono variance ${varClass} pnl-td-primary`}>
                                  {varBs == null ? '—' : (varBs >= 0 ? '+' : '') + fmt(varBs, 2)}
                                </td>
                                <td className="pnl-td right mono">{fmtPct(row.net_margin_pct)}</td>
                                <td className="pnl-td right mono muted">{fmtExpectedMargin(row.casper_expected_profit_pct)}</td>
                                <td className="pnl-td right mono">{fmt(row.earnings_per_unit, 2)}</td>
                                <td className="pnl-td right mono red">{fmt(row.reverse_shipping_fee, 2)}</td>
                                <td className="pnl-td center">
                                  <span className={`pnl-status-pill ${row.is_matched ? 'matched' : 'unmatched'}`}>
                                    {row.is_matched ? 'Matched' : 'No Data'}
                                  </span>
                                </td>
                              </tr>
                            )
                          })}
                          {filteredRows.length === 0 && (
                            <tr><td colSpan={11} className="pnl-td center" style={{ padding: '32px', color: 'var(--text-3)' }}>No SKUs match your filter</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

              </div>
            )
          )}

          {/* All Time view */}
          {pnlView === 'lifetime' && lifetimeData && (
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
                              <button className="pnl-lt-open-btn" title="Flipkart Report" onClick={() => loadDetail(r.id, 'fk')}>📄</button>
                              <button className="pnl-lt-open-btn pnl-lt-open-pnl" title="Real P&L" onClick={() => loadDetail(r.id, 'pnl')}>📊</button>
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

          {pnlView === 'lifetime' && reports.length === 0 && (
            <div className="pnl-empty-state">
              <div className="pnl-empty-icon">📊</div>
              <div className="pnl-empty-title">No reports yet</div>
              <div className="pnl-empty-sub">Upload reports to see lifetime P&amp;L</div>
              <button className="pnl-btn-ghost" onClick={() => setTab(0)}>← Go to Reports</button>
            </div>
          )}

          {pnlView === 'bysku' && (
            <div className="pnl-animate-in pnl-empty-state">
              <div className="pnl-empty-icon">🔬</div>
              <div className="pnl-empty-title">Lifetime By SKU</div>
              <div className="pnl-empty-sub">Cross-report SKU performance — coming soon</div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab 2: Insights ── */}
      {tab === 2 && (
        <div className="pnl-body pnl-insights-body">
          {!selectedReport ? (
            <div className="pnl-empty-state">
              <div className="pnl-empty-icon">💡</div>
              <div className="pnl-empty-title">No report selected</div>
              <div className="pnl-empty-sub">Open a Flipkart Report first to see insights</div>
              <button className="pnl-btn-ghost" onClick={() => setTab(0)}>← Go to Reports</button>
            </div>
          ) : insightsData && (
            <div className="ins-grid">
              <div className="ins-kpis">
                <div className="ins-kpi">
                  <div className="ins-kpi-label">Flipkart Settlement</div>
                  <div className="ins-kpi-val gold">{fmt(insightsData.totalActualBS)}</div>
                  <div className="ins-kpi-sub">{insightsData.beatingCount + insightsData.missingCount} matched SKUs</div>
                </div>
                <div className="ins-kpi">
                  <div className="ins-kpi-label">Your Target Settlement</div>
                  <div className="ins-kpi-val">{fmt(insightsData.totalExpectedBS)}</div>
                  <div className="ins-kpi-sub">Based on SKU pricing formula</div>
                </div>
                <div className={`ins-kpi ${insightsData.netVariance >= 0 ? 'ins-kpi-pos' : 'ins-kpi-neg'}`}>
                  <div className="ins-kpi-label">Net P&amp;L Signal</div>
                  <div className={`ins-kpi-val ${insightsData.netVariance >= 0 ? 'green' : 'red'}`}>
                    {insightsData.netVariance >= 0 ? '+' : ''}{fmt(insightsData.netVariance)}
                  </div>
                  <div className="ins-kpi-sub">Actual vs your target</div>
                </div>
                <div className="ins-kpi ins-kpi-warn">
                  <div className="ins-kpi-label">Return Shipping Cost</div>
                  <div className="ins-kpi-val red">{fmt(-insightsData.totalRevShipping)}</div>
                  <div className="ins-kpi-sub">Biggest single fee this period</div>
                </div>
              </div>

              <div className="ins-two-col">
                <div className="ins-panel">
                  <div className="ins-panel-hdr">
                    <div>
                      <div className="ins-panel-title">Settlement Variance by SKU</div>
                      <div className="ins-panel-sub">Actual Flipkart payment vs your pricing target</div>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={insightsData.varianceChartData} layout="vertical" margin={{ top: 4, right: 48, left: 4, bottom: 0 }}>
                      <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `₹${v}`} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={70} axisLine={false} tickLine={false} />
                      <Tooltip formatter={v => [`₹${Number(v).toLocaleString('en-IN')}`, 'Variance']} labelFormatter={(_, p) => p?.[0]?.payload?.fullName || ''} contentStyle={{ fontSize: 12 }} />
                      <Bar dataKey="variance" radius={[0, 3, 3, 0]} barSize={14}>
                        {insightsData.varianceChartData.map((entry, i) => (
                          <Cell key={i} fill={entry.variance >= 0 ? '#22c55e' : '#ef4444'} fillOpacity={0.85} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="ins-var-legend">
                    <span className="ins-vleg green">▲ {insightsData.beatingCount} SKUs beating target (+{fmt(insightsData.beatingTotal)})</span>
                    <span className="ins-vleg red">▼ {insightsData.missingCount} SKUs below target ({fmt(insightsData.missingTotal)})</span>
                  </div>
                </div>

                <div className="ins-panel">
                  <div className="ins-panel-hdr">
                    <div>
                      <div className="ins-panel-title">Where Your Money Goes</div>
                      <div className="ins-panel-sub">Net sales → bank settlement breakdown</div>
                    </div>
                  </div>
                  <div className="ins-waterfall">
                    {[
                      { label: 'Net Sales',        value: selectedReport.net_sales,               type: 'base'    },
                      { label: 'Reverse Shipping', value: -insightsData.totalRevShipping,         type: 'cost'    },
                      { label: 'GST on Fees',      value: -insightsData.totalGST,                 type: 'cost'    },
                      { label: 'TCS / TDS',        value: -insightsData.totalTax,                 type: 'cost'    },
                      { label: 'Commission',       value: -insightsData.totalCommission,          type: 'cost'    },
                      { label: 'Collection Fee',   value: -insightsData.totalCollection,          type: 'cost'    },
                      { label: 'Rewards',          value: insightsData.totalRewards,              type: 'benefit' },
                      { label: 'Bank Settlement',  value: selectedReport.bank_settlement,         type: 'result'  },
                    ].map((item, i) => {
                      const base = selectedReport.net_sales || 1
                      const barW = Math.min(Math.abs(item.value) / base * 100, 100)
                      const pctLbl = ((item.value / base) * 100).toFixed(1) + '%'
                      return (
                        <div key={i} className={`ins-wf-row ins-wf-${item.type}`}>
                          <div className="ins-wf-label">{item.label}</div>
                          <div className="ins-wf-bar-wrap"><div className="ins-wf-bar" style={{ width: `${barW}%` }} /></div>
                          <div className="ins-wf-val">{item.value < 0 ? '−' : ''}{fmt(Math.abs(item.value))}</div>
                          <div className="ins-wf-pct">{pctLbl}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="ins-two-col">
                <div className="ins-panel">
                  <div className="ins-panel-hdr">
                    <div>
                      <div className="ins-panel-title">Return Analysis</div>
                      <div className="ins-panel-sub">Where your {fmtN(selectedReport.gross_units)} gross units went</div>
                    </div>
                  </div>
                  <div className="ins-ret-grid">
                    {[
                      { label: 'Delivered',  value: selectedReport.net_units,    cls: 'green', icon: '✓' },
                      { label: 'RTO',        value: insightsData.totalRTO,       cls: 'amber', icon: '↩' },
                      { label: 'RVP',        value: insightsData.totalRVP,       cls: 'red',   icon: '↩' },
                      { label: 'Cancelled',  value: insightsData.totalCancelled, cls: 'muted', icon: '✕' },
                    ].map((item, i) => {
                      const pct = ((item.value / (selectedReport.gross_units || 1)) * 100).toFixed(1)
                      return (
                        <div key={i} className={`ins-ret-card ins-ret-${item.cls}`}>
                          <div className="ins-ret-icon">{item.icon}</div>
                          <div className="ins-ret-num">{item.value}</div>
                          <div className="ins-ret-lbl">{item.label}</div>
                          <div className="ins-ret-pct">{pct}%</div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="ins-ret-note">
                    Avg return shipping cost per returned unit: {fmt(insightsData.totalRevShipping / Math.max(insightsData.totalRTO + insightsData.totalRVP, 1))}
                  </div>
                </div>

                <div className="ins-panel">
                  <div className="ins-panel-hdr">
                    <div>
                      <div className="ins-panel-title">Flipkart Margin Distribution</div>
                      <div className="ins-panel-sub">Net margin % per SKU after Flipkart fees</div>
                    </div>
                  </div>
                  <div className="ins-margin-dist">
                    {insightsData.marginBrackets.map((b, i) => {
                      const pct = (b.count / (selectedReport.total_skus || 1)) * 100
                      return (
                        <div key={i} className="ins-md-row">
                          <div className="ins-md-label">{b.label}</div>
                          <div className="ins-md-bar-wrap"><div className="ins-md-bar" style={{ width: `${pct}%`, background: b.color }} /></div>
                          <div className="ins-md-count">{b.count} SKUs</div>
                          <div className="ins-md-pct">{pct.toFixed(0)}%</div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="ins-margin-note">
                    ⚠ Flipkart Margin = after Flipkart fees only. Add your purchase cost for true business margin.
                  </div>
                </div>
              </div>
            </div>
          )}
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
                  <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => setFile(e.target.files[0])} />
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
