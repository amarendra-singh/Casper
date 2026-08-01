import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  getLedger, getLedgerSummary, createLedgerEntry, updateLedgerEntry, deleteLedgerEntry,
  getVendors, getSkus,
} from '../api/client'
import './Ledger.css'

const EXPENSE_CATS = ['inventory', 'logistics', 'packaging', 'ads', 'salary', 'rent', 'utilities', 'tax', 'platform_fee', 'refund', 'misc']
const INCOME_CATS  = ['settlement', 'sale', 'refund_received', 'other_income']
const METHODS      = ['bank_transfer', 'upi', 'cash', 'card', 'cheque', 'other']
const CHART_COLORS = ['#EC2D6E', '#7A5BFF', '#D97706', '#1FA968', '#2874F0', '#F23A77', '#0EA5E9', '#DB2777', '#65A30D', '#9333EA', '#E11D48']

const today = () => new Date().toISOString().slice(0, 10)
const monthKey = d => (d || '').slice(0, 7)
const blank = () => ({
  entry_date: today(), direction: 'expense', category: 'inventory', amount: '',
  vendor_id: '', party_name: '', sku_id: '', bank_name: '', payment_method: 'bank_transfer',
  reference_no: '', note: '',
})
const fmt   = n => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const fmtP  = n => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const label = s => (s || '').replace(/_/g, ' ')

function StatCard({ label, value, tone, sub, icon }) {
  return (
    <div className={`lg-stat lg-stat-${tone}`}>
      <div className="lg-stat-top">
        <span className="lg-stat-ic">{icon}</span>
        <span className="lg-stat-lbl">{label}</span>
      </div>
      <div className="lg-stat-val">{value}</div>
      {sub && <div className="lg-stat-sub">{sub}</div>}
    </div>
  )
}

export default function Ledger() {
  const [entries, setEntries] = useState([])
  const [summary, setSummary] = useState({ total_income: 0, total_expense: 0, net: 0, count: 0, by_category: [] })
  const [vendors, setVendors] = useState([])
  const [skus, setSkus]       = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState({ start: '', end: '', direction: '' })
  const [tab, setTab]         = useState('overview')  // overview | entries
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId]   = useState(null)
  const [draft, setDraft]     = useState(blank())
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const params = {}
    if (filter.start) params.start = filter.start
    if (filter.end) params.end = filter.end
    if (filter.direction) params.direction = filter.direction
    try {
      const [e, s] = await Promise.all([getLedger(params), getLedgerSummary(params)])
      setEntries(e); setSummary(s)
    } catch (err) { setError(err.response?.data?.detail || 'Failed to load ledger') }
    finally { setLoading(false) }
  }, [filter])

  useEffect(() => { load() }, [load])
  useEffect(() => { getVendors().then(setVendors).catch(() => {}); getSkus().then(setSkus).catch(() => {}) }, [])

  // ── Report aggregations (client-side, from loaded entries) ──────────────────
  const expenseByCat = useMemo(() =>
    (summary.by_category || []).filter(b => b.direction === 'expense')
      .map((b, i) => ({ name: label(b.category), value: b.total, color: CHART_COLORS[i % CHART_COLORS.length] })),
    [summary])

  const monthly = useMemo(() => {
    const m = {}
    for (const e of entries) {
      const k = monthKey(e.entry_date)
      if (!m[k]) m[k] = { month: k, expense: 0, income: 0 }
      m[k][e.direction] += e.amount
    }
    return Object.values(m).sort((a, b) => a.month.localeCompare(b.month)).slice(-6)
  }, [entries])

  const topParties = useMemo(() => {
    const m = {}
    for (const e of entries) {
      if (e.direction !== 'expense') continue
      const key = e.vendor_name || e.party_name || 'Unassigned'
      m[key] = (m[key] || 0) + e.amount
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [entries])

  const maxParty = topParties[0]?.[1] || 1

  // ── Form ────────────────────────────────────────────────────────────────────
  const set = (k, v) => setDraft(d => {
    const next = { ...d, [k]: v }
    if (k === 'direction') next.category = (v === 'income' ? INCOME_CATS : EXPENSE_CATS)[0]
    return next
  })
  const openAdd  = () => { setEditId(null); setDraft(blank()); setShowForm(true); setTab('entries'); setError('') }
  const openEdit = e => {
    setEditId(e.id)
    setDraft({
      entry_date: e.entry_date, direction: e.direction, category: e.category, amount: String(e.amount),
      vendor_id: e.vendor_id || '', party_name: e.party_name || '', sku_id: e.sku_id || '',
      bank_name: e.bank_name || '', payment_method: e.payment_method || 'bank_transfer',
      reference_no: e.reference_no || '', note: e.note || '',
    })
    setShowForm(true); setTab('entries'); setError('')
  }
  const save = async () => {
    if (!draft.amount || Number(draft.amount) <= 0) { setError('Enter an amount greater than 0'); return }
    setBusy(true); setError('')
    const payload = {
      ...draft, amount: Number(draft.amount),
      vendor_id: draft.vendor_id ? Number(draft.vendor_id) : null,
      sku_id: draft.sku_id ? Number(draft.sku_id) : null,
      party_name: draft.party_name.trim() || null, bank_name: draft.bank_name.trim() || null,
      reference_no: draft.reference_no.trim() || null, note: draft.note.trim() || null,
    }
    try {
      if (editId) await updateLedgerEntry(editId, payload); else await createLedgerEntry(payload)
      setShowForm(false); setEditId(null); setDraft(blank()); await load()
    } catch (err) { setError(err.response?.data?.detail || 'Save failed') }
    finally { setBusy(false) }
  }
  const remove = async e => {
    if (!window.confirm(`Delete this ${e.direction} of ${fmtP(e.amount)}?`)) return
    try { await deleteLedgerEntry(e.id); await load() }
    catch (err) { setError(err.response?.data?.detail || 'Delete failed') }
  }

  const exportCSV = () => {
    const cols = ['entry_date', 'direction', 'category', 'vendor_name', 'party_name', 'sku_code', 'amount', 'bank_name', 'payment_method', 'reference_no', 'note']
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [cols.join(','), ...entries.map(e => cols.map(c => esc(e[c])).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `casper_expenses_${today()}.csv`
    a.click(); URL.revokeObjectURL(a.href)
  }

  const cats = draft.direction === 'income' ? INCOME_CATS : EXPENSE_CATS
  const thisMonth = monthly.find(m => m.month === monthKey(today()))?.expense || 0

  return (
    <div className="lg">
      <header className="lg-head">
        <div>
          <h1 className="lg-title">Expense Ledger</h1>
          <p className="lg-sub">Every rupee in and out — categorised, by vendor, bank and SKU</p>
        </div>
        <div className="lg-head-actions">
          <button className="lg-btn-ghost" onClick={exportCSV} disabled={!entries.length}>Export CSV</button>
          <button className="lg-add-btn" onClick={openAdd}>+ New entry</button>
        </div>
      </header>

      {/* Stat cards */}
      <div className="lg-stats">
        <StatCard label="Total out" tone="out" value={fmt(summary.total_expense)} sub={`${summary.count} entries`}
          icon={<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 4v12M6 12l4 4 4-4"/></svg>} />
        <StatCard label="Total in" tone="in" value={fmt(summary.total_income)}
          icon={<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 16V4M6 8l4-4 4 4"/></svg>} />
        <StatCard label="Net" tone={summary.net >= 0 ? 'in' : 'out'} value={fmt(summary.net)} sub={summary.net >= 0 ? 'surplus' : 'deficit'}
          icon={<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10h14M10 3v14"/></svg>} />
        <StatCard label="This month" tone="neutral" value={fmt(thisMonth)} sub="spent"
          icon={<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="14" height="13" rx="2"/><path d="M3 8h14M7 2v4M13 2v4"/></svg>} />
      </div>

      {/* Tabs */}
      <div className="lg-tabs">
        <button className={`lg-tab${tab === 'overview' ? ' on' : ''}`} onClick={() => setTab('overview')}>Reports</button>
        <button className={`lg-tab${tab === 'entries' ? ' on' : ''}`} onClick={() => setTab('entries')}>Entries</button>
      </div>

      {error && <div className="lg-error" role="alert">{error}</div>}

      {loading ? <div className="lg-loading"><div className="loader" style={{ width: 26, height: 26 }} /></div> : tab === 'overview' ? (
        /* ── REPORTS ─────────────────────────────────────────────────────── */
        summary.count === 0 ? (
          <div className="lg-empty"><p>No data yet — add entries to see reports.</p><button className="lg-add-btn" onClick={openAdd}>+ Record your first entry</button></div>
        ) : (
          <div className="lg-reports">
            <div className="lg-card">
              <div className="lg-card-h">Expense by category</div>
              {expenseByCat.length === 0 ? <div className="lg-card-empty">No expenses</div> : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={expenseByCat} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}>
                      {expenseByCat.map((e, i) => <Cell key={i} fill={e.color} stroke="none" />)}
                    </Pie>
                    <Tooltip formatter={v => fmtP(v)} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="lg-card">
              <div className="lg-card-h">Monthly in vs out (last 6)</div>
              {monthly.length === 0 ? <div className="lg-card-empty">No data</div> : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={monthly} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} tickLine={false} axisLine={false} tickFormatter={v => v >= 1000 ? `${v / 1000}k` : v} />
                    <Tooltip formatter={v => fmtP(v)} cursor={{ fill: 'rgba(0,0,0,.04)' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="income" name="In" fill="#1FA968" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="expense" name="Out" fill="#EC2D6E" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="lg-card lg-card-wide">
              <div className="lg-card-h">Top expense parties</div>
              {topParties.length === 0 ? <div className="lg-card-empty">No expenses</div> : (
                <div className="lg-bars">
                  {topParties.map(([name, val]) => (
                    <div className="lg-bar-row" key={name}>
                      <span className="lg-bar-name" title={name}>{name}</span>
                      <div className="lg-bar-track"><div className="lg-bar-fill" style={{ width: `${(val / maxParty) * 100}%` }} /></div>
                      <span className="lg-bar-val">{fmt(val)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      ) : (
        /* ── ENTRIES ─────────────────────────────────────────────────────── */
        <>
          <div className="lg-filters">
            <label>From <input type="date" value={filter.start} onChange={e => setFilter(f => ({ ...f, start: e.target.value }))} /></label>
            <label>To <input type="date" value={filter.end} onChange={e => setFilter(f => ({ ...f, end: e.target.value }))} /></label>
            <label>Type
              <select value={filter.direction} onChange={e => setFilter(f => ({ ...f, direction: e.target.value }))}>
                <option value="">All</option><option value="expense">Expense</option><option value="income">Income</option>
              </select>
            </label>
            {(filter.start || filter.end || filter.direction) && <button className="lg-clear" onClick={() => setFilter({ start: '', end: '', direction: '' })}>Clear</button>}
          </div>

          {showForm && (
            <div className="lg-form">
              <div className="lg-form-grid">
                <label>Date<input type="date" value={draft.entry_date} onChange={e => set('entry_date', e.target.value)} /></label>
                <label>Type<select value={draft.direction} onChange={e => set('direction', e.target.value)}><option value="expense">Expense (out)</option><option value="income">Income (in)</option></select></label>
                <label>Category<select value={draft.category} onChange={e => set('category', e.target.value)}>{cats.map(c => <option key={c} value={c}>{label(c)}</option>)}</select></label>
                <label>Amount ₹<input type="number" min="0" step="0.01" value={draft.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" /></label>
                <label>Vendor<select value={draft.vendor_id} onChange={e => set('vendor_id', e.target.value)}><option value="">— none —</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
                <label>Party name<input value={draft.party_name} onChange={e => set('party_name', e.target.value)} placeholder="if not a saved vendor" /></label>
                <label>SKU<select value={draft.sku_id} onChange={e => set('sku_id', e.target.value)}><option value="">— none —</option>{skus.map(s => <option key={s.id} value={s.id}>{s.shringar_sku}</option>)}</select></label>
                <label>Bank name<input value={draft.bank_name} onChange={e => set('bank_name', e.target.value)} placeholder="e.g. HDFC Bank" /></label>
                <label>Payment method<select value={draft.payment_method} onChange={e => set('payment_method', e.target.value)}>{METHODS.map(m => <option key={m} value={m}>{label(m)}</option>)}</select></label>
                <label>Reference no<input value={draft.reference_no} onChange={e => set('reference_no', e.target.value)} placeholder="txn / invoice / cheque" /></label>
                <label className="lg-note-field">Note<input value={draft.note} onChange={e => set('note', e.target.value)} placeholder="optional" /></label>
              </div>
              <div className="lg-form-actions">
                <button className="lg-save" onClick={save} disabled={busy}>{busy ? 'Saving…' : editId ? 'Update entry' : 'Add entry'}</button>
                <button className="lg-cancel" onClick={() => { setShowForm(false); setEditId(null) }}>Cancel</button>
              </div>
            </div>
          )}

          {entries.length === 0 ? (
            <div className="lg-empty"><p>No ledger entries yet.</p><button className="lg-add-btn" onClick={openAdd}>+ Record your first entry</button></div>
          ) : (
            <div className="lg-table-wrap">
              <table className="lg-table">
                <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Party</th><th>SKU</th><th className="num">Amount</th><th>Bank</th><th>Method</th><th>Ref</th><th>Note</th><th></th></tr></thead>
                <tbody>
                  {entries.map(e => (
                    <tr key={e.id}>
                      <td className="mono">{e.entry_date}</td>
                      <td><span className={`lg-dir ${e.direction}`}>{e.direction === 'income' ? 'In' : 'Out'}</span></td>
                      <td>{label(e.category)}</td>
                      <td>{e.vendor_name || e.party_name || '—'}</td>
                      <td className="mono">{e.sku_code || '—'}</td>
                      <td className={`num mono ${e.direction}`}>{e.direction === 'income' ? '+' : '−'}{fmtP(e.amount)}</td>
                      <td>{e.bank_name || '—'}</td>
                      <td>{label(e.payment_method) || '—'}</td>
                      <td className="mono">{e.reference_no || '—'}</td>
                      <td className="lg-note-cell" title={e.note || ''}>{e.note || '—'}</td>
                      <td className="lg-actions">
                        <button className="lg-edit" onClick={() => openEdit(e)} aria-label="Edit entry">✎</button>
                        <button className="lg-del" onClick={() => remove(e)} aria-label="Delete entry">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
