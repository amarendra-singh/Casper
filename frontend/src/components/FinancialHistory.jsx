import { useCallback, useEffect, useState } from 'react'
import { getFinancialHistory, undoFinancialChange, errText } from '../api/client'
import { useConfirm } from './ConfirmDialog'
import { useCompany } from '../context/CompanyContext'

const ENTITIES = {
  invoice_receipts: 'Invoice receipt',
  marketplace_sku_aliases: 'Marketplace product mapping',
  vendor_name_aliases: 'Supplier name',
  sku_pricing: 'Pricing',
  sku_platform_config: 'Platform settings',
  invoices: 'Invoice',
  invoice_lines: 'Invoice line',
  ledger_entries: 'Ledger entry',
  purchase_bills: 'Supplier bill',
  purchase_bill_lines: 'Supplier bill line',
}
const label = key => key.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase())

export default function FinancialHistory({ refreshKey = 0 }) {
  const { ask, dialog } = useConfirm()
  const { role, isAll, activeId } = useCompany()
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const undo = async id => {
    setBusy(true); setError('')
    try { await undoFinancialChange(id); await load() }
    catch (e) {setError(errText(e, 'Could not undo the change'))}
    finally {setBusy(false)}
  }
  const load = useCallback(async beforeId => {
    setBusy(true)
    setError('')
    try {
      const next = await getFinancialHistory(beforeId)
      setRows(previous => (beforeId ? [...previous, ...next] : next))
      setHasMore(next.length === 100)
    } catch (e) {
      setError(errText(e, 'Could not load financial history'))
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    if (role === 'owner' || role === 'admin') {load()}
  }, [activeId, role, load, refreshKey])
  if (isAll || !['owner', 'admin'].includes(role)) {return null}
  return (
    <section
      className="st-add-card"
      style={{ marginBottom: 16 }}
      aria-label="Financial change history"
    >
      <h2 className="st-title" style={{ fontSize: 16 }}>
        Financial change history
      </h2>
      {dialog}
      <p className="st-sub">
        Committed changes to pricing, invoices, supplier bills and ledger records.
        Undo supports pricing and manual ledger edits. Historical report costs stay unchanged.
      </p>
      {error && (
        <p role="alert">
          {error} <button onClick={() => load()}>Retry</button>
        </p>
      )}
      {busy && <p role="status">Loading history…</p>}
      {!busy && !error && !rows.length && (
        <p>No financial changes recorded since history was enabled.</p>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="lg-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Record</th>
              <th>Action</th>
              <th>Changed by</th>
              <th>Changes</th>
              <th>Undo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const fields = [
                ...new Set([...Object.keys(row.before || {}), ...Object.keys(row.after || {})]),
              ].filter(
                key =>
                  !['id', 'company_id'].includes(key) && row.before?.[key] !== row.after?.[key],
              )
              return (
                <tr key={row.id}>
                  <td>{new Date(`${row.created_at}Z`).toLocaleString()}</td>
                  <td>
                    {ENTITIES[row.entity_type] || label(row.entity_type)} #{row.entity_id}
                  </td>
                  <td>{label(row.action)}</td>
                  <td>{row.actor_id ? `User #${row.actor_id}` : 'System'}</td>
                  <td>
                    <details>
                      <summary>{fields.length} changed fields</summary>
                      <dl>
                        {fields.map(key => (
                          <div key={key}>
                            <dt>{label(key)}</dt>
                            <dd>
                              {String(row.before?.[key] ?? '—')} → {String(row.after?.[key] ?? '—')}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  </td>
                  <td>{row.undo_available ? <button disabled={busy} onClick={() => ask({
                    title: 'Undo this edit?', confirmLabel: 'Undo edit',
                    body: 'Restore the previous recorded values. Newer edits block undo; frozen reports stay unchanged.',
                    onConfirm: () => undo(row.id),
                  })}>Undo edit</button> : 'Use original workflow'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <button disabled={busy} onClick={() => load(rows.at(-1)?.id)}>
          Load older changes
        </button>
      )}
    </section>
  )
}
