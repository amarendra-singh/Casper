import { Link } from 'react-router-dom'
import { useState, useEffect, useMemo } from 'react'
import SmartCell from './SmartCell'
import CreateBillSkuModal from './CreateBillSkuModal'
import BillCostSetup from './BillCostSetup'
import { useCompany } from '../context/CompanyContext'
import {
  checkBillDiscrepancies, getPurchaseBills, linkBillLine,
  getBillSkuOptions, errText, autoMatchPurchaseBills, editBillRow,
} from '../api/client'

/**
 * Bill Discrepancies — supplier bills against our own SKU costs.
 *
 * Bills (what we BOUGHT) are saved; the Flipkart order list (what we SOLD) is
 * only displayed, since the two are opposite sides of the business and share no
 * key. No figure is ever calculated across the two files.
 *
 * The cost check is: bill rate ÷ Units = unit cost, compared against the SKU's
 * recorded Product Cost per base unit. Piece always has one unit; box and set
 * require an explicit unit count instead of guessing from a SKU code.
 */
const money = n => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`)

const costDifference = (line, price, draft = null) => {
  const type = draft?.unit ?? line.unit
  const units = type === 'piece' ? 1 : Number(draft?.pieces_per_unit ?? line.pieces_per_unit)
  if (!units || !line.base_units_per_sku || price === '' || line.recorded_cost == null ||
      !['manual', 'alias'].includes(line.match_source) ||
      new Set((line.platform_costs || []).map(p => p.price)).size > 1) { return null }
  return Number((Number(price) / units - line.recorded_cost / line.base_units_per_sku).toFixed(2))
}

function Flag({ children, tone = 'warn' }) {
  return <span className={`bd-flag bd-${tone}`}>{children}</span>
}

function Upload({ label, hint, accept, file, onPick }) {
  return (
    <div className="bd-pick">
      <span className="bd-pick-label">{label} <small>{hint}</small></span>
      <div className="bd-pick-row">
        <label className="bd-btn">
          {file ? 'Change file' : 'Choose file'}
          <input aria-label={(file ? 'Change file' : 'Choose file')} type="file" accept={accept}
            onChange={e => onPick(e.target.files?.[0] || null)} />
        </label>
        <span className={`bd-fname${file ? ' on' : ''}`}>{file ? file.name : 'No file chosen'}</span>
        {file && <button className="bd-clear" onClick={() => onPick(null)} aria-label="Remove file">✕</button>}
      </div>
    </div>
  )
}

export default function BillDiscrepancies({ onSaved }) {
  const { role, isAll } = useCompany()
  const canWrite = !isAll && ['owner', 'admin'].includes(role)
  const [ordersFile, setOrdersFile] = useState(null)
  const [billsFile,  setBillsFile]  = useState(null)
  const [orders, setOrders] = useState([])
  const [bills,  setBills]  = useState([])
  const [skus,   setSkus]   = useState([])
  const [summary, setSummary] = useState(null)
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState('')
  const [note,  setNote]  = useState('')
  const [skuLoading, setSkuLoading] = useState(false)
  // What the user is currently typing per line. SmartCell filters on its own
  // `value`, so without this the box would always filter against the saved code
  // and show the whole catalogue.
  const [skuDraft, setSkuDraft] = useState({})
  const [packDraft, setPackDraft] = useState({})
  const [rowDraft, setRowDraft] = useState({})
  const [savingRow, setSavingRow] = useState(null)
  const [createTarget, setCreateTarget] = useState(null)
  const [costTarget, setCostTarget] = useState(null)

  // Bills persist, so show whatever is already stored before any upload.
  useEffect(() => {
    if (isAll) {return}
    let current = true
    const loadBills = async () => {
      try {
        if (canWrite) {
          const result = await autoMatchPurchaseBills()
          if (current && result.matched) {setNote(`${result.matched} lines matched from saved supplier mappings.`); await onSaved?.()}
        }
      } catch (e) {if (current) {setError(errText(e, 'Automatic matching failed. Use Refresh SKUs to retry.'))}}
      try {const rows = await getPurchaseBills(); if (current) {setBills(rows)}}
      catch {if (current) {setError('Could not load supplier bills. Please retry.')}}
    }
    loadBills()
    getBillSkuOptions().then(setSkus).catch(() => setError('Could not load SKUs for matching. Please retry.'))
    return () => {current = false}
  }, [canWrite, isAll, onSaved])

  const refreshSkus = async () => {
    setSkuLoading(true); setError('')
    try {
      setSkus(await getBillSkuOptions())
      if (canWrite) {
        const result = await autoMatchPurchaseBills()
        setNote(`${result.matched} additional lines matched from saved supplier mappings.`)
        if (result.matched) {await onSaved?.()}
      }
      await refresh()
    }
    catch (e) {setError(errText(e, 'Could not load SKUs for matching. Please retry.'))}
    finally {setSkuLoading(false)}
  }

  const refresh = () => getPurchaseBills().then(setBills).catch(() => setError('Could not load supplier bills. Please retry.'))

  const run = async () => {
    if (!ordersFile && !billsFile) { setError('Choose an order list, a bill statement, or both.'); return }
    setBusy(true); setError(''); setNote('')
    try {
      const fd = new FormData()
      if (ordersFile) {fd.append('orders_csv', ordersFile)}
      if (billsFile)  {fd.append('bills_pdf',  billsFile)}
      const res = await checkBillDiscrepancies(fd)
      setOrders(res.orders || [])
      setSummary(res.summary || null)
      if (res.stored_bills?.length) {setBills(res.stored_bills)}
      const s = res.saved || {}
      if (s.skipped_transactions) {setNote(`${s.skipped_transactions} payment/credit or unsupported transactions were not posted as purchase expenses.`)}
      if (s.bills_created || s.bills_updated) {
        await onSaved?.()
        setNote(`${s.bills_created} bills added, ${s.bills_updated} updated.${s.skipped_transactions ? ` ${s.skipped_transactions} non-purchase transactions skipped.` : ''}`)
      }
    } catch (e) {
      setError(errText(e, 'Could not read those files'))
    } finally {
      setBusy(false)
    }
  }

  const doLink = async (line, sku_id, pack_multiple) => {
    if (!canWrite) {return}
    setError('')
    const pack = Number(packDraft[line.id] ?? pack_multiple)
    if (!Number.isFinite(pack) || pack <= 0) {setError('Enter a positive billed-unit conversion before confirming the SKU.'); return}
    try {
      const result = await linkBillLine(line.id, { sku_id: sku_id || undefined, pack_multiple: pack, remember: true })
      if (result.warning) {setNote(result.warning)}
      await refresh()
      await onSaved?.()
    } catch (e) { setError(errText(e, 'Could not link that line')) }
  }

  // One shared option list for every row's search box.
  const skuOpts = useMemo(
    () => skus.map(s => ({ id: s.id, label: s.shringar_sku,
      sublabel: [s.vendor_sku, s.description, ...(s.aliases || [])].filter(Boolean).join(' · ') })), [skus])

  const billLines = bills.flatMap(b =>
    (b.lines.length ? b.lines : [null]).map((ln, i) => ({ b, ln, first: i === 0 })))
  const confirmed = l => l.sku_id && ['manual', 'alias'].includes(l.match_source)
  const linked   = bills.flatMap(b => b.lines).filter(confirmed).length
  const suggested = bills.flatMap(b => b.lines).filter(l => l.match_source === 'suggested').length
  const totalLn  = bills.flatMap(b => b.lines).length
  const mismatch = bills.flatMap(b => b.lines).filter(l => confirmed(l) && costDifference(l, l.price_unit) != null && costDifference(l, l.price_unit) !== 0).length

  if (isAll) {return <p className="bd-hint">Choose a company to view and match its supplier bills.</p>}

  return (
    <div className="bd">
      {costTarget && canWrite && <BillCostSetup line={costTarget} onClose={() => setCostTarget(null)}
        onSave={() => {setCostTarget(null); setNote('Cost saved. Eligible unpriced reports have been connected.'); refresh(); onSaved?.()}} />}
      {createTarget && canWrite && <CreateBillSkuModal {...createTarget}
        onClose={() => setCreateTarget(null)}
        onCreated={sku => setSkus(current => [...current.filter(s => s.id !== sku.id), sku])}
        onSave={() => {
          setSkuDraft(current => { const next = { ...current }; delete next[createTarget.line.id]; return next })
          setPackDraft(current => { const next = { ...current }; delete next[createTarget.line.id]; return next })
          setCreateTarget(null)
          refresh()
          onSaved?.()
        }} />}
      <div className="bd-upload">
        <button className="bd-btn" onClick={refreshSkus} disabled={skuLoading}>
          {skuLoading ? 'Refreshing SKUs…' : 'Refresh SKUs'}
        </button>
        <Upload label="Order list" hint="Flipkart .csv" accept=".csv,text/csv"
          file={ordersFile} onPick={setOrdersFile} />
        <Upload label="Bill statement" hint="Vyapar .pdf" accept=".pdf,application/pdf"
          file={billsFile} onPick={setBillsFile} />
        <button className="bd-run" onClick={run} disabled={busy || !canWrite}>
          {busy ? 'Reading…' : 'Upload & match'}
        </button>
      </div>

      {error && <div className="lg-error" role="alert">{error}</div>}
      {note && <div className="bd-note" role="status">{note}</div>}

      {!bills.length && !orders.length && !error && (
        <p className="bd-hint">
          Upload a supplier bill statement to match its items to your SKUs and
          compare each billed rate against the cost you have recorded.
        </p>
      )}

      {(summary || bills.length > 0) && (
        <div className="lg-stats bd-stats">
          <div className="lg-stat"><div className="lg-stat-lbl">Bills</div>
            <div className="lg-stat-val">{bills.length}</div>
            <div className="lg-stat-sub">{totalLn} lines</div></div>
          <div className="lg-stat"><div className="lg-stat-lbl">Matched to SKU</div>
            <div className="lg-stat-val">{linked}</div>
            <div className="lg-stat-sub">{totalLn - linked} unconfirmed{suggested ? ` · ${suggested} suggested` : ''}</div></div>
          <div className="lg-stat"><div className="lg-stat-lbl">Cost mismatches</div>
            <div className="lg-stat-val">{mismatch}</div>
            <div className="lg-stat-sub">billed rate ≠ recorded cost</div></div>
          <div className="lg-stat"><div className="lg-stat-lbl">Orders</div>
            <div className="lg-stat-val">{summary?.order_count ?? 0}</div>
            <div className="lg-stat-sub">{money(summary?.orders_total)} invoiced</div></div>
        </div>
      )}

      {!!bills.length && (
        <section className="bd-sec">
          <h3 className="bd-h">Bill items vs your SKU cost <small>{bills.length} bills</small></h3>
          <div className="lg-table-wrap">
            <table className="lg-table bd-table bd-editor">
              <thead>
                <tr>
                  <th>Date</th><th>Ref</th><th>Item</th>
                  <th className="num">Quantity</th><th>Type</th><th className="num">Units</th><th className="num">Rate</th><th className="num">Amount</th><th className="num">Unit cost</th>
                  <th>Matched SKU</th><th className="num">Recorded</th><th className="num">Diff</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {billLines.map(({ b, ln, first }, _i) => (
                  <tr key={ln ? ln.id : `${b.id}-x`} className={[first ? 'bd-first' : '', rowDraft[ln?.id] ? 'bd-dirty' : ''].filter(Boolean).join(' ')}>
                    {['bill_date', 'ref_no', 'item_name', 'quantity', 'unit', 'pieces_per_unit', 'price', 'amount'].map(field => {
                      if (!ln) { return <td key={field}>—</td> }
                      const row = rowDraft[ln.id] || { bill_date: b.bill_date, ref_no: b.ref_no, item_name: ln.item_name,
                        quantity: ln.quantity ?? '', amount: ln.amount ?? '', unit: ln.unit === 'item' ? '' : ln.unit || '',
                        pieces_per_unit: ln.pieces_per_unit ?? '',
                        price: ln.quantity > 0 && ln.amount != null ? Number((ln.amount / ln.quantity).toFixed(4)) : '' }
                      const numeric = ['quantity', 'pieces_per_unit', 'price', 'amount'].includes(field)
                      if (field === 'unit') { return <td key={field} className="bd-field-cell bd-field-unit" data-label="Type">
                        <select className="bd-input" aria-label="Type" disabled={!canWrite} value={row.unit}
                          onChange={e => setRowDraft(d => ({ ...d, [ln.id]: { ...row, unit: e.target.value, pieces_per_unit: e.target.value === 'piece' ? 1 : '' } }))}>
                          <option value="">Choose type</option><option value="piece">Piece</option><option value="box">Box</option><option value="set">Set</option>
                        </select></td> }
                      if (field === 'pieces_per_unit' && row.unit === 'piece') { return <td key={field} className="bd-field-cell bd-field-pieces_per_unit" data-label="Units"><span className="bd-one-piece">—</span></td> }
                      return <td key={field} className={`bd-field-cell bd-field-${field}`} data-label={field === 'bill_date' ? 'Date' : field === 'ref_no' ? 'Ref' : field === 'item_name' ? 'Item' : field === 'pieces_per_unit' ? 'Units' : field === 'price' ? 'Rate' : field}><input aria-label={field === 'bill_date' ? 'Date' : field === 'ref_no' ? 'Ref' : field === 'item_name' ? 'Item' : field === 'pieces_per_unit' ? 'Units' : field === 'price' ? 'Rate' : field[0].toUpperCase() + field.slice(1)}
                        className={`bd-input${numeric ? ' bd-input-number' : ''}`} title={String(row[field] ?? '')} type={field === 'bill_date' ? 'date' : numeric ? 'number' : 'text'}
                        step={field === 'pieces_per_unit' ? '1' : numeric ? 'any' : undefined} min={numeric ? (['quantity', 'pieces_per_unit'].includes(field) ? '1' : '0') : undefined}
                        readOnly={!canWrite} value={row[field]} onChange={e => {
                          const next = { ...row, [field]: e.target.value }
                          const q = Number(next.quantity)
                          if (field === 'price' && next.price !== '' && q > 0) { next.amount = Number((Number(next.price) * q).toFixed(2)) }
                          if (['amount', 'quantity'].includes(field)) { next.price = q > 0 && next.amount !== '' ? Number((Number(next.amount) / q).toFixed(4)) : '' }
                          setRowDraft(d => ({ ...d, [ln.id]: next }))
                        }} /></td>
                    })}
                    <td className="num mono bd-unit-cost" data-label="Unit cost">{ln && (() => {
                      const row = rowDraft[ln.id]
                      const type = row?.unit ?? ln.unit
                      const units = type === 'piece' ? 1 : Number(row?.pieces_per_unit ?? ln.pieces_per_unit)
                      const rate = row?.price ?? ln.price_unit ?? (ln.quantity > 0 && ln.amount != null ? ln.amount / ln.quantity : null)
                      return units > 0 && rate !== '' && rate != null ? money(Number(rate) / units) : '—'
                    })()}</td>
                    <td className="bd-skucell" data-label="Matched SKU">
                      {ln && (
                        /* Type-to-search, not a dropdown — a catalogue can run to
                           thousands of SKUs, and there is one of these per line. */
                        <SmartCell
                          value={skuDraft[ln.id] ?? ln.sku_code ?? ''}
                          readOnly={!canWrite}
                          options={[...skuOpts].sort((a, b) =>
                            Number(ln.candidates?.some(c => c.id === b.id) || false) - Number(ln.candidates?.some(c => c.id === a.id) || false))}
                          placeholder="search SKU…"
                          addNewLabel="Create SKU"
                          onAddNew={canWrite ? code => setCreateTarget({ line: ln, bill: b, code }) : undefined}
                          onChange={v => {
                            setSkuDraft(d => ({ ...d, [ln.id]: v }))
                          }}
                          onSelect={opt => {
                            setSkuDraft(d => { const n = { ...d }; delete n[ln.id]; return n })
                            doLink(ln, opt.id, ln.pack_multiple)
                          }}
                        />
                      )}
                      <div className="bd-match-actions">
                      {ln?.match_source === 'suggested' && <Flag>suggested</Flag>}
                      {ln?.match_source === 'alias' && <Flag tone="ok">remembered</Flag>}
                      {ln?.sku_id && canWrite && <button className="bd-clear" onClick={() => doLink(ln, null, ln.pack_multiple)} title="Clear this match and forget the saved mapping for this supplier item">Clear match</button>}
                      </div>
                      {ln?.match_reason && <small className="bd-match-reason">{ln.candidates?.length ? `${ln.candidates.length} candidate${ln.candidates.length === 1 ? '' : 's'}: ` : ''}{ln.match_reason}</small>}
                    </td>
                    <td className="num mono bd-recorded" data-label="Recorded">{ln ? (ln.platform_costs?.length ? ln.platform_costs.map(p => <div key={p.platform_id}>{ln.base_units_per_sku ? money(p.price / ln.base_units_per_sku) : '—'}<small>Platform #{p.platform_id}</small></div>) : 'Not recorded') : ''}</td>
                    <td className="num mono bd-difference" data-label="Difference">
                      {ln && costDifference(ln, rowDraft[ln.id]?.price ?? ln.price_unit, rowDraft[ln.id]) != null && new Set((ln.platform_costs || []).map(p => p.price)).size <= 1 && (
                        costDifference(ln, rowDraft[ln.id]?.price ?? ln.price_unit, rowDraft[ln.id]) === 0
                          ? <Flag tone="ok">match</Flag>
                          : <Flag tone="bad">{costDifference(ln, rowDraft[ln.id]?.price ?? ln.price_unit, rowDraft[ln.id]) > 0 ? '+' : ''}{money(costDifference(ln, rowDraft[ln.id]?.price ?? ln.price_unit, rowDraft[ln.id]))}</Flag>
                      )}
                    </td>
                    <td className="bd-row-actions" data-label="Actions">{ln && canWrite && <button className="bd-save" disabled={!rowDraft[ln.id] || savingRow !== null} onClick={async () => {
                      const row = rowDraft[ln.id]
                      if (!row || row.quantity === '' || row.amount === '' || Number(row.quantity) <= 0 || !row.unit || (row.unit !== 'piece' && !Number(row.pieces_per_unit))) { setError('Enter a positive quantity and an amount.'); return }
                      setSavingRow(ln.id); setError('')
                      try {
                        await editBillRow(ln.id, { bill_date: row.bill_date, ref_no: row.ref_no, item_name: row.item_name, quantity: Number(row.quantity), amount: Number(row.amount), unit: row.unit, pieces_per_unit: row.unit === 'piece' ? 1 : Number(row.pieces_per_unit) })
                        setRowDraft(d => { const next = { ...d }; delete next[ln.id]; return next })
                        await refresh(); await onSaved?.(); setNote('Row saved. Bill totals and ledger updated. Recorded SKU costs change only through cost approval.')
                      } catch (e) { setError(errText(e, 'Could not save row')) }
                      finally { setSavingRow(null) }
                    }}>{savingRow === ln.id ? 'Saving…' : 'Save row'}</button>}{ln && (confirmed(ln) ?
                      <Link className="bd-review" to={`/product/catalogue/${ln.sku_id}?billLine=${ln.id}#approved-cost`}>
                        {ln.stock_item_id && ln.base_units_per_sku ? 'Review / edit cost' : 'Set up cost'}
                      </Link> : <small>Match SKU first</small>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="bd-foot">Rate = Amount ÷ Quantity. Unit cost = Rate ÷ Units per box or set; Piece is always one unit. Editing Rate updates Amount; editing Amount or Quantity updates Rate. Date and Ref apply to the whole bill. Save each edited row. Recorded cost is shown per piece only when the SKU pack size is confirmed. Cost changes are reviewed separately.</p>
        </section>
      )}

      {!!orders.length && (
        <section className="bd-sec">
          <h3 className="bd-h">Order list <small>{orders.length} orders · {money(summary?.orders_total)}</small></h3>
          <div className="lg-table-wrap">
            <table className="lg-table bd-table">
              <thead>
                <tr><th>Date</th><th>SKU</th><th>Product</th><th>Invoice no.</th>
                  <th className="num">Qty</th><th className="num">Amount</th><th>Status</th><th>Flag</th></tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.order_id}>
                    <td className="mono nowrap">{o.ordered_on}</td>
                    <td className="mono">{o.sku || '—'}</td>
                    <td className="bd-prod" title={o.product}>{o.product}</td>
                    <td className="mono">{o.invoice_no || '—'}</td>
                    <td className="num mono">{o.quantity}</td>
                    <td className="num mono">{money(o.invoice_amount)}</td>
                    <td className="nowrap">{o.state}</td>
                    <td>
                      {!o.sku_known && <Flag>not in catalogue</Flag>}
                      {/return/i.test(o.state || '') && <Flag tone="bad">returned</Flag>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
