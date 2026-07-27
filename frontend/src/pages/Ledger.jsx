import { useState, useEffect, useCallback } from 'react'
import {
  getLedger, getLedgerSummary, createLedgerEntry, updateLedgerEntry, deleteLedgerEntry,
  getVendors, getSkus,
} from '../api/client'
import './Ledger.css'

const EXPENSE_CATS = ['inventory', 'logistics', 'packaging', 'ads', 'salary', 'rent', 'utilities', 'tax', 'platform_fee', 'refund', 'misc']
const INCOME_CATS  = ['settlement', 'sale', 'refund_received', 'other_income']
const METHODS      = ['bank_transfer', 'upi', 'cash', 'card', 'cheque', 'other']

const today = () => new Date().toISOString().slice(0, 10)
const blank = () => ({
  entry_date: today(), direction: 'expense', category: 'inventory', amount: '',
  vendor_id: '', party_name: '', sku_id: '', bank_name: '', payment_method: 'bank_transfer',
  reference_no: '', note: '',
})
const fmt  = n => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const label = s => (s || '').replace(/_/g, ' ')

export default function Ledger() {
  const [entries, setEntries] = useState([])
  const [summary, setSummary] = useState({ total_income: 0, total_expense: 0, net: 0, count: 0 })
  const [vendors, setVendors] = useState([])
  const [skus, setSkus]       = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState({ start: '', end: '', direction: '' })
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

  const set = (k, v) => setDraft(d => {
    const next = { ...d, [k]: v }
    // switching direction resets category to a valid one for that direction
    if (k === 'direction') next.category = (v === 'income' ? INCOME_CATS : EXPENSE_CATS)[0]
    return next
  })

  const openAdd  = () => { setEditId(null); setDraft(blank()); setShowForm(true); setError('') }
  const openEdit = e => {
    setEditId(e.id)
    setDraft({
      entry_date: e.entry_date, direction: e.direction, category: e.category, amount: String(e.amount),
      vendor_id: e.vendor_id || '', party_name: e.party_name || '', sku_id: e.sku_id || '',
      bank_name: e.bank_name || '', payment_method: e.payment_method || 'bank_transfer',
      reference_no: e.reference_no || '', note: e.note || '',
    })
    setShowForm(true); setError('')
  }

  const save = async () => {
    if (!draft.amount || Number(draft.amount) <= 0) { setError('Enter an amount greater than 0'); return }
    setBusy(true); setError('')
    const payload = {
      ...draft,
      amount: Number(draft.amount),
      vendor_id: draft.vendor_id ? Number(draft.vendor_id) : null,
      sku_id: draft.sku_id ? Number(draft.sku_id) : null,
      party_name: draft.party_name.trim() || null,
      bank_name: draft.bank_name.trim() || null,
      reference_no: draft.reference_no.trim() || null,
      note: draft.note.trim() || null,
    }
    try {
      if (editId) await updateLedgerEntry(editId, payload)
      else await createLedgerEntry(payload)
      setShowForm(false); setEditId(null); setDraft(blank())
      await load()
    } catch (err) { setError(err.response?.data?.detail || 'Save failed') }
    finally { setBusy(false) }
  }

  const remove = async e => {
    if (!window.confirm(`Delete this ${e.direction} of ${fmt(e.amount)}?`)) return
    try { await deleteLedgerEntry(e.id); await load() }
    catch (err) { setError(err.response?.data?.detail || 'Delete failed') }
  }

  const cats = draft.direction === 'income' ? INCOME_CATS : EXPENSE_CATS

  return (
    <div className="lg">
      <header className="lg-head">
        <div>
          <h1 className="lg-title">Billing &amp; Expense Ledger</h1>
          <p className="lg-sub">Every rupee in and out — vendors, banks, SKUs and notes in one place</p>
        </div>
        <button className="lg-add-btn" onClick={openAdd}>+ New entry</button>
      </header>

      {/* Summary tiles */}
      <div className="lg-tiles">
        <div className="lg-tile"><span className="lg-tile-lbl">Income</span><span className="lg-tile-val in">{fmt(summary.total_income)}</span></div>
        <div className="lg-tile"><span className="lg-tile-lbl">Expense</span><span className="lg-tile-val out">{fmt(summary.total_expense)}</span></div>
        <div className="lg-tile"><span className="lg-tile-lbl">Net</span><span className={`lg-tile-val ${summary.net >= 0 ? 'in' : 'out'}`}>{fmt(summary.net)}</span></div>
        <div className="lg-tile"><span className="lg-tile-lbl">Entries</span><span className="lg-tile-val">{summary.count}</span></div>
      </div>

      {/* Filters */}
      <div className="lg-filters">
        <label>From <input type="date" value={filter.start} onChange={e => setFilter(f => ({ ...f, start: e.target.value }))} /></label>
        <label>To <input type="date" value={filter.end} onChange={e => setFilter(f => ({ ...f, end: e.target.value }))} /></label>
        <label>Type
          <select value={filter.direction} onChange={e => setFilter(f => ({ ...f, direction: e.target.value }))}>
            <option value="">All</option><option value="expense">Expense</option><option value="income">Income</option>
          </select>
        </label>
        {(filter.start || filter.end || filter.direction) &&
          <button className="lg-clear" onClick={() => setFilter({ start: '', end: '', direction: '' })}>Clear</button>}
      </div>

      {error && <div className="lg-error" role="alert">{error}</div>}

      {/* Add / edit form */}
      {showForm && (
        <div className="lg-form">
          <div className="lg-form-grid">
            <label>Date<input type="date" value={draft.entry_date} onChange={e => set('entry_date', e.target.value)} /></label>
            <label>Type
              <select value={draft.direction} onChange={e => set('direction', e.target.value)}>
                <option value="expense">Expense (out)</option><option value="income">Income (in)</option>
              </select>
            </label>
            <label>Category
              <select value={draft.category} onChange={e => set('category', e.target.value)}>
                {cats.map(c => <option key={c} value={c}>{label(c)}</option>)}
              </select>
            </label>
            <label>Amount ₹<input type="number" min="0" step="0.01" value={draft.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" /></label>
            <label>Vendor
              <select value={draft.vendor_id} onChange={e => set('vendor_id', e.target.value)}>
                <option value="">— none —</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label>Party name<input value={draft.party_name} onChange={e => set('party_name', e.target.value)} placeholder="if not a saved vendor" /></label>
            <label>SKU
              <select value={draft.sku_id} onChange={e => set('sku_id', e.target.value)}>
                <option value="">— none —</option>
                {skus.map(s => <option key={s.id} value={s.id}>{s.shringar_sku}</option>)}
              </select>
            </label>
            <label>Bank name<input value={draft.bank_name} onChange={e => set('bank_name', e.target.value)} placeholder="e.g. HDFC Bank" /></label>
            <label>Payment method
              <select value={draft.payment_method} onChange={e => set('payment_method', e.target.value)}>
                {METHODS.map(m => <option key={m} value={m}>{label(m)}</option>)}
              </select>
            </label>
            <label>Reference no<input value={draft.reference_no} onChange={e => set('reference_no', e.target.value)} placeholder="txn / invoice / cheque" /></label>
            <label className="lg-note-field">Note<input value={draft.note} onChange={e => set('note', e.target.value)} placeholder="optional" /></label>
          </div>
          <div className="lg-form-actions">
            <button className="lg-save" onClick={save} disabled={busy}>{busy ? 'Saving…' : editId ? 'Update entry' : 'Add entry'}</button>
            <button className="lg-cancel" onClick={() => { setShowForm(false); setEditId(null) }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? <div className="lg-loading"><div className="loader" style={{ width: 26, height: 26 }} /></div>
        : entries.length === 0 ? (
          <div className="lg-empty">
            <p>No ledger entries yet.</p>
            <button className="lg-add-btn" onClick={openAdd}>+ Record your first entry</button>
          </div>
        ) : (
          <div className="lg-table-wrap">
            <table className="lg-table">
              <thead>
                <tr>
                  <th>Date</th><th>Type</th><th>Category</th><th>Party</th><th>SKU</th>
                  <th className="num">Amount</th><th>Bank</th><th>Method</th><th>Ref</th><th>Note</th><th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id}>
                    <td className="mono">{e.entry_date}</td>
                    <td><span className={`lg-dir ${e.direction}`}>{e.direction === 'income' ? 'In' : 'Out'}</span></td>
                    <td>{label(e.category)}</td>
                    <td>{e.vendor_name || e.party_name || '—'}</td>
                    <td className="mono">{e.sku_code || '—'}</td>
                    <td className={`num mono ${e.direction}`}>{e.direction === 'income' ? '+' : '−'}{fmt(e.amount)}</td>
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
    </div>
  )
}
