import { useState } from 'react'
import { previewPricingRefresh, applyPricingRefresh, errText } from '../api/client'

export default function PricingRefresh({ onApplied }) {
  const [plan, setPlan] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const run = async apply => {
    setBusy(true); setMessage('')
    try {
      if (apply) {
        const result = await applyPricingRefresh(plan.token)
        onApplied?.()
        setPlan(null); setMessage(`${result.updated} pricing records refreshed; ${result.rows_matched} report rows connected.`)
      } else {setPlan(await previewPricingRefresh())}
    } catch (error) {setMessage(errText(error, 'Could not refresh pricing')); setPlan(null)}
    finally {setBusy(false)}
  }
  return <section className="st-add-card" aria-label="Refresh saved pricing">
    <h2>Refresh saved pricing</h2>
    <p>Recalculate derived return charges and miscellaneous costs using current settings. Saved percentages and explicit amount overrides remain unchanged. Frozen report costs stay unchanged.</p>
    <button disabled={busy} onClick={() => run(false)}>Preview recalculation</button>
    {plan && <>
      <p>{plan.updates.length} pricing records will change. Undo individual edits in financial history.</p>
      <div style={{ maxHeight: 300, overflow: 'auto' }}><table className="lg-table">
        <thead><tr><th>SKU / platform</th><th>Changes</th></tr></thead>
        <tbody>{plan.updates.map(row => <tr key={row.id}><td>{row.sku} / #{row.platform_id}</td>
          <td>{Object.entries(row.changes).map(([key, value]) => <div key={key}>{key.replaceAll('_', ' ')}: {value.before} → {value.after}</div>)}</td></tr>)}</tbody>
      </table></div>
      <button disabled={busy || !plan.updates.length} onClick={() => run(true)}>Apply reviewed changes</button>
      <button disabled={busy} onClick={() => setPlan(null)}>Cancel</button>
    </>}
    {message && <p role="status">{message}</p>}
  </section>
}
