import { useState, useEffect, useCallback, useMemo } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import api, { getSkus } from '../api/client'
import { useCompany } from '../context/CompanyContext'
import './Ledger.css'
import './Billing.css'

const STATUSES = ['draft', 'sent', 'paid', 'cancelled']
const STATUS_COLOR = { draft: '#9A9A9F', sent: '#2874F0', paid: '#1FA968', overdue: '#EC2D6E', cancelled: '#B8B6B2' }
const today = () => new Date().toISOString().slice(0, 10)
const fmt  = n => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const fmtP = n => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const cap  = s => (s || '').charAt(0).toUpperCase() + (s || '').slice(1)

const getInvoices = (params) => api.get('/billing/', { params }).then(r => r.data)
const getSummary  = () => api.get('/billing/summary').then(r => r.data)
const createInv   = (d) => api.post('/billing/', d).then(r => r.data)
const updateInv   = (id, d) => api.patch(`/billing/${id}`, d).then(r => r.data)
const deleteInv   = (id) => api.delete(`/billing/${id}`)

const blankLine  = () => ({ description: '', sku_id: '', quantity: 1, unit_price: 0 })
const blankDraft = () => ({
  invoice_date: today(), due_date: '', customer_name: '', customer_gstin: '',
  gst_pct: 3, status: 'draft', amount_paid: 0, bank_name: '', notes: '', lines: [blankLine()],
})

function Stat({ label, value, tone, sub }) {
  return (
    <div className={`lg-stat lg-stat-${tone}`}>
      <div className="lg-stat-top"><span className="lg-stat-lbl">{label}</span></div>
      <div className="lg-stat-val">{value}</div>
      {sub && <div className="lg-stat-sub">{sub}</div>}
    </div>
  )
}

export default function Billing() {
  const [invoices, setInvoices] = useState([])
  const [summary, setSummary]   = useState({ total_invoiced: 0, total_paid: 0, outstanding: 0, overdue: 0, count: 0, by_status: [], aging: {} })
  const [skus, setSkus]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState('overview')
  const [filter, setFilter]     = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId]     = useState(null)
  const [draft, setDraft]       = useState(blankDraft())
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')
  const [printInv, setPrintInv] = useState(null)
  const { activeCompany } = useCompany()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [inv, s] = await Promise.all([getInvoices(filter ? { status: filter } : {}), getSummary()])
      setInvoices(inv); setSummary(s)
    } catch (e) { setError(e.response?.data?.detail || 'Failed to load invoices') }
    finally { setLoading(false) }
  }, [filter])
  useEffect(() => { load() }, [load])
  useEffect(() => { getSkus().then(setSkus).catch(() => {}) }, [])

  // live totals for the form
  const subtotal = useMemo(() => draft.lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0), [draft.lines])
  const tax = useMemo(() => subtotal * (Number(draft.gst_pct) || 0) / 100, [subtotal, draft.gst_pct])
  const total = subtotal + tax

  const statusData = useMemo(() =>
    (summary.by_status || []).filter(b => b.count > 0).map(b => ({ name: cap(b.status), value: b.count, color: STATUS_COLOR[b.status] || '#9A9A9F' })),
    [summary])
  const aging = summary.aging || {}
  const maxAge = Math.max(aging['0-30'] || 0, aging['31-60'] || 0, aging['60+'] || 0, 1)

  const setF = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const setLine = (i, k, v) => setDraft(d => ({ ...d, lines: d.lines.map((l, j) => j === i ? { ...l, [k]: v } : l) }))
  const addLine = () => setDraft(d => ({ ...d, lines: [...d.lines, blankLine()] }))
  const rmLine  = i => setDraft(d => ({ ...d, lines: d.lines.filter((_, j) => j !== i) }))

  const openAdd = () => { setEditId(null); setDraft(blankDraft()); setShowForm(true); setTab('invoices'); setError('') }
  const openEdit = inv => {
    setEditId(inv.id)
    setDraft({
      invoice_date: inv.invoice_date, due_date: inv.due_date || '', customer_name: inv.customer_name,
      customer_gstin: inv.customer_gstin || '', gst_pct: inv.gst_pct, status: inv.status === 'overdue' ? 'sent' : inv.status,
      amount_paid: inv.amount_paid, bank_name: inv.bank_name || '', notes: inv.notes || '',
      lines: inv.lines.length ? inv.lines.map(l => ({ description: l.description, sku_id: l.sku_id || '', quantity: l.quantity, unit_price: l.unit_price })) : [blankLine()],
    })
    setShowForm(true); setTab('invoices'); setError('')
  }

  const save = async () => {
    if (!draft.customer_name.trim()) { setError('Customer name is required'); return }
    if (!draft.lines.some(l => l.description.trim())) { setError('Add at least one line item'); return }
    setBusy(true); setError('')
    const payload = {
      invoice_date: draft.invoice_date, due_date: draft.due_date || null,
      customer_name: draft.customer_name.trim(), customer_gstin: draft.customer_gstin.trim() || null,
      gst_pct: Number(draft.gst_pct) || 0, status: draft.status, amount_paid: Number(draft.amount_paid) || 0,
      bank_name: draft.bank_name.trim() || null, notes: draft.notes.trim() || null,
      lines: draft.lines.filter(l => l.description.trim()).map(l => ({
        description: l.description.trim(), sku_id: l.sku_id ? Number(l.sku_id) : null,
        quantity: Number(l.quantity) || 0, unit_price: Number(l.unit_price) || 0,
      })),
    }
    try {
      if (editId) await updateInv(editId, payload); else await createInv(payload)
      setShowForm(false); setEditId(null); setDraft(blankDraft()); await load()
    } catch (e) { setError(e.response?.data?.detail || 'Save failed') }
    finally { setBusy(false) }
  }

  const markPaid = async inv => { try { await updateInv(inv.id, { status: 'paid', amount_paid: inv.total }); await load() } catch { /* noop */ } }
  const remove = async inv => { if (window.confirm(`Delete invoice ${inv.number}?`)) { try { await deleteInv(inv.id); await load() } catch { /* noop */ } } }

  return (
    <div className="lg">
      <header className="lg-head">
        <div>
          <h1 className="lg-title">Billing &amp; Invoices</h1>
          <p className="lg-sub">Issue invoices, track payments, and chase what's overdue</p>
        </div>
        <button className="lg-add-btn" onClick={openAdd}>+ New invoice</button>
      </header>

      <div className="lg-stats">
        <Stat label="Invoiced" tone="neutral" value={fmt(summary.total_invoiced)} sub={`${summary.count} invoices`} />
        <Stat label="Paid" tone="in" value={fmt(summary.total_paid)} />
        <Stat label="Outstanding" tone="out" value={fmt(summary.outstanding)} />
        <Stat label="Overdue" tone="out" value={fmt(summary.overdue)} sub="past due date" />
      </div>

      <div className="lg-tabs">
        <button className={`lg-tab${tab === 'overview' ? ' on' : ''}`} onClick={() => setTab('overview')}>Reports</button>
        <button className={`lg-tab${tab === 'invoices' ? ' on' : ''}`} onClick={() => setTab('invoices')}>Invoices</button>
      </div>

      {error && <div className="lg-error" role="alert">{error}</div>}

      {loading ? <div className="lg-loading"><div className="loader" style={{ width: 26, height: 26 }} /></div> : tab === 'overview' ? (
        summary.count === 0 ? (
          <div className="lg-empty"><p>No invoices yet — create one to see reports.</p><button className="lg-add-btn" onClick={openAdd}>+ Create your first invoice</button></div>
        ) : (
          <div className="lg-reports">
            <div className="lg-card">
              <div className="lg-card-h">Invoices by status</div>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}>
                    {statusData.map((e, i) => <Cell key={i} fill={e.color} stroke="none" />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [`${v} invoice(s)`, n]} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="lg-card">
              <div className="lg-card-h">Overdue aging</div>
              <div className="lg-bars" style={{ marginTop: 18 }}>
                {['0-30', '31-60', '60+'].map(k => (
                  <div className="lg-bar-row" key={k}>
                    <span className="lg-bar-name">{k} days</span>
                    <div className="lg-bar-track"><div className="lg-bar-fill" style={{ width: `${((aging[k] || 0) / maxAge) * 100}%` }} /></div>
                    <span className="lg-bar-val">{fmt(aging[k] || 0)}</span>
                  </div>
                ))}
              </div>
              <p className="bl-aging-note">Total overdue: <b>{fmtP(summary.overdue)}</b> across {statusData.find(s => s.name === 'Overdue')?.value || 0} invoice(s)</p>
            </div>
          </div>
        )
      ) : (
        <>
          <div className="lg-filters">
            <label>Status
              <select value={filter} onChange={e => setFilter(e.target.value)}>
                <option value="">All</option>
                {['draft', 'sent', 'paid', 'overdue', 'cancelled'].map(s => <option key={s} value={s}>{cap(s)}</option>)}
              </select>
            </label>
          </div>

          {showForm && (
            <div className="lg-form">
              <div className="lg-form-grid">
                <label>Invoice date<input type="date" value={draft.invoice_date} onChange={e => setF('invoice_date', e.target.value)} /></label>
                <label>Due date<input type="date" value={draft.due_date} onChange={e => setF('due_date', e.target.value)} /></label>
                <label>Customer<input value={draft.customer_name} onChange={e => setF('customer_name', e.target.value)} placeholder="Customer name" /></label>
                <label>Customer GSTIN<input value={draft.customer_gstin} onChange={e => setF('customer_gstin', e.target.value)} placeholder="optional" /></label>
                <label>GST %<input type="number" min="0" step="0.01" value={draft.gst_pct} onChange={e => setF('gst_pct', e.target.value)} /></label>
                <label>Status<select value={draft.status} onChange={e => setF('status', e.target.value)}>{STATUSES.map(s => <option key={s} value={s}>{cap(s)}</option>)}</select></label>
                <label>Amount paid ₹<input type="number" min="0" step="0.01" value={draft.amount_paid} onChange={e => setF('amount_paid', e.target.value)} /></label>
                <label>Bank<input value={draft.bank_name} onChange={e => setF('bank_name', e.target.value)} placeholder="e.g. HDFC Bank" /></label>
                <label className="lg-note-field">Notes<input value={draft.notes} onChange={e => setF('notes', e.target.value)} placeholder="optional" /></label>
              </div>

              {/* Line items */}
              <div className="bl-lines">
                <div className="bl-lines-h"><span>Line items</span><button className="bl-add-line" onClick={addLine}>+ Add line</button></div>
                <div className="bl-line bl-line-head"><span>Description</span><span>SKU</span><span className="num">Qty</span><span className="num">Unit ₹</span><span className="num">Amount</span><span /></div>
                {draft.lines.map((l, i) => (
                  <div className="bl-line" key={i}>
                    <input value={l.description} onChange={e => setLine(i, 'description', e.target.value)} placeholder="Item description" />
                    <select value={l.sku_id} onChange={e => setLine(i, 'sku_id', e.target.value)}><option value="">—</option>{skus.map(s => <option key={s.id} value={s.id}>{s.shringar_sku}</option>)}</select>
                    <input className="num" type="number" min="0" step="1" value={l.quantity} onChange={e => setLine(i, 'quantity', e.target.value)} />
                    <input className="num" type="number" min="0" step="0.01" value={l.unit_price} onChange={e => setLine(i, 'unit_price', e.target.value)} />
                    <span className="bl-line-amt num">{fmtP((Number(l.quantity) || 0) * (Number(l.unit_price) || 0))}</span>
                    <button className="bl-rm-line" onClick={() => rmLine(i)} aria-label="Remove line" disabled={draft.lines.length === 1}>✕</button>
                  </div>
                ))}
                <div className="bl-totals">
                  <div><span>Subtotal</span><b>{fmtP(subtotal)}</b></div>
                  <div><span>GST ({draft.gst_pct || 0}%)</span><b>{fmtP(tax)}</b></div>
                  <div className="bl-grand"><span>Total</span><b>{fmtP(total)}</b></div>
                </div>
              </div>

              <div className="lg-form-actions">
                <button className="lg-save" onClick={save} disabled={busy}>{busy ? 'Saving…' : editId ? 'Update invoice' : 'Create invoice'}</button>
                <button className="lg-cancel" onClick={() => { setShowForm(false); setEditId(null) }}>Cancel</button>
              </div>
            </div>
          )}

          {invoices.length === 0 ? (
            <div className="lg-empty"><p>No invoices{filter ? ` with status “${filter}”` : ''}.</p><button className="lg-add-btn" onClick={openAdd}>+ New invoice</button></div>
          ) : (
            <div className="lg-table-wrap">
              <table className="lg-table">
                <thead><tr><th>Number</th><th>Date</th><th>Due</th><th>Customer</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Balance</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {invoices.map(inv => (
                    <tr key={inv.id}>
                      <td className="mono">{inv.number}</td>
                      <td className="mono">{inv.invoice_date}</td>
                      <td className="mono">{inv.due_date || '—'}</td>
                      <td>{inv.customer_name}</td>
                      <td className="num mono">{fmtP(inv.total)}</td>
                      <td className="num mono">{fmtP(inv.amount_paid)}</td>
                      <td className="num mono">{fmtP(inv.balance)}</td>
                      <td><span className="bl-status" style={{ color: STATUS_COLOR[inv.status], background: `${STATUS_COLOR[inv.status]}1a` }}>{cap(inv.status)}</span></td>
                      <td className="lg-actions">
                        <button className="bl-view" onClick={() => setPrintInv(inv)} title="View / download PDF" aria-label="View invoice PDF">⎙</button>
                        {inv.status !== 'paid' && inv.status !== 'cancelled' && <button className="bl-paid" onClick={() => markPaid(inv)} title="Mark paid">✓</button>}
                        <button className="lg-edit" onClick={() => openEdit(inv)} aria-label="Edit invoice">✎</button>
                        <button className="lg-del" onClick={() => remove(inv)} aria-label="Delete invoice">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Professional printable / PDF invoice */}
      {printInv && (
        <div className="bl-doc-overlay" onClick={e => { if (e.target === e.currentTarget) setPrintInv(null) }}>
          <div className="bl-doc-bar bl-noprint">
            <button className="lg-save" onClick={() => window.print()}>⬇ Download / Print PDF</button>
            <button className="lg-cancel" onClick={() => setPrintInv(null)}>Close</button>
          </div>
          <div className="bl-doc" id="invoice-print">
            <div className="bl-doc-head">
              <div>
                <div className="bl-doc-co">{activeCompany?.name || 'Company'}</div>
                <div className="bl-doc-tag">TAX INVOICE</div>
              </div>
              <div className="bl-doc-numbox">
                <div className="bl-doc-num">{printInv.number}</div>
                <span className="bl-status" style={{ color: STATUS_COLOR[printInv.status], background: `${STATUS_COLOR[printInv.status]}1a` }}>{cap(printInv.status)}</span>
              </div>
            </div>

            <div className="bl-doc-meta">
              <div className="bl-doc-billto">
                <span>Bill To</span>
                <b>{printInv.customer_name}</b>
                {printInv.customer_gstin && <div>GSTIN: {printInv.customer_gstin}</div>}
              </div>
              <div className="bl-doc-dates">
                <div><span>Invoice date</span> {printInv.invoice_date}</div>
                <div><span>Due date</span> {printInv.due_date || '—'}</div>
              </div>
            </div>

            <table className="bl-doc-table">
              <thead><tr><th>#</th><th>Description</th><th className="num">Qty</th><th className="num">Unit ₹</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {printInv.lines.map((l, i) => (
                  <tr key={l.id}>
                    <td>{i + 1}</td><td>{l.description}</td>
                    <td className="num">{l.quantity}</td><td className="num">{fmtP(l.unit_price)}</td><td className="num">{fmtP(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="bl-doc-totals">
              <div><span>Subtotal</span><b>{fmtP(printInv.subtotal)}</b></div>
              <div><span>GST ({printInv.gst_pct}%)</span><b>{fmtP(printInv.tax_amount)}</b></div>
              <div className="bl-doc-grand"><span>Total</span><b>{fmtP(printInv.total)}</b></div>
              <div><span>Amount paid</span><b>{fmtP(printInv.amount_paid)}</b></div>
              <div className="bl-doc-due"><span>Balance due</span><b>{fmtP(printInv.balance)}</b></div>
            </div>

            {printInv.bank_name && <div className="bl-doc-note"><span>Payable to</span> {printInv.bank_name}</div>}
            {printInv.notes && <div className="bl-doc-note"><span>Notes</span> {printInv.notes}</div>}
            <div className="bl-doc-foot">Thank you for your business.</div>
          </div>
        </div>
      )}
    </div>
  )
}
