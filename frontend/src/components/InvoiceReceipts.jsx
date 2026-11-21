import { useEffect, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import api, { errText } from '../api/client'
import { localDate } from '../lib/format'

export default function InvoiceReceipts({ invoice, onClose, onSaved }) {
  const [amount, setAmount] = useState(String(invoice.balance || 0))
  const [receiptDate, setReceiptDate] = useState(localDate())
  const [method, setMethod] = useState('bank_transfer')
  const [reference, setReference] = useState('')
  const [requestKey] = useState(() => crypto.randomUUID())
  const [receipts, setReceipts] = useState([])
  const [reversing, setReversing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    api.get(`/billing/${invoice.id}/receipts`).then(r => {if (current) {setReceipts(r.data)}})
      .catch(e => {if (current) {setError(errText(e, 'Could not load receipts'))}})
    return () => {current = false}
  }, [invoice.id])
  const valid = receiptDate && (reversing || (Number.isFinite(Number(amount)) && Number(amount) > 0 && Number(amount) <= invoice.balance))
  const save = async () => {
    if (busy || !valid) {return}
    setBusy(true); setError('')
    try {
      if (reversing) {
        await api.post(`/billing/receipts/${reversing.id}/reverse`, { reversal_date: receiptDate })
      } else {
        await api.post(`/billing/${invoice.id}/receipts`, { amount: Number(amount), receipt_date: receiptDate,
          payment_method: method, reference_no: reference.trim() || null, request_key: requestKey })
      }
      await onSaved(); onClose()
    } catch (e) {setError(errText(e, 'Could not save receipt'))}
    finally {setBusy(false)}
  }
  return <ConfirmDialog open dialogRole="dialog" className="workflow-dialog" title={`Receipts: ${invoice.number}`}
    onCancel={() => !busy && onClose()} onConfirm={save} confirmDisabled={busy || !valid}
    confirmLabel={reversing ? 'Confirm reversal' : 'Record receipt'}>
    <p>Paid {invoice.amount_paid}; outstanding {invoice.balance}. Only dated receipts below are linked to the ledger. Older paid totals may have no receipt record.</p>
    <label>Date<input aria-label="Receipt or reversal date" type="date" value={receiptDate} disabled={busy} onChange={e => setReceiptDate(e.target.value)} /></label>
    {reversing ? <p>Reverse receipt #{reversing.id} for {reversing.amount}? This posts an equal offset in the ledger and reopens the invoice balance. The original receipt remains recorded.
      <button disabled={busy} onClick={() => setReversing(null)}>Keep receipt</button></p> : <>
      <label>Amount<input aria-label="Receipt amount" type="number" min="0.01" step="0.01" value={amount} disabled={busy} onChange={e => setAmount(e.target.value)} /></label>
      <label>Method<select aria-label="Receipt method" value={method} disabled={busy} onChange={e => setMethod(e.target.value)}>
        {['bank_transfer', 'upi', 'cash', 'card', 'cheque', 'other'].map(m => <option key={m} value={m}>{m.replaceAll('_', ' ')}</option>)}
      </select></label>
      <label>Reference<input aria-label="Receipt reference" maxLength={100} value={reference} disabled={busy} onChange={e => setReference(e.target.value)} /></label>
    </>}
    <ul>{receipts.map(r => <li key={r.id}>{r.receipt_date}: {r.amount} — {r.reversed ? 'Reversed' :
      <button disabled={busy} onClick={() => setReversing(r)}>Reverse receipt #{r.id}</button>}</li>)}</ul>
    {error && <p role="alert">{error}</p>}
  </ConfirmDialog>
}
