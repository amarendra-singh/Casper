import { useEffect, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import SmartCell from './SmartCell'
import { getPlatforms, createPricing, errText } from '../api/client'

const FIELDS = { package: 'Packaging', logistics: 'Logistics', addons: 'Add-ons',
  misc_total: 'Miscellaneous', cr_cost: 'Return allowance', damage_cost: 'Damage allowance',
  gst: 'GST %', profit_percentage: 'Target markup %' }

export default function BillCostSetup({ line, onSave, onClose }) {
  const [platforms, setPlatforms] = useState([])
  const [platform, setPlatform] = useState(null)
  const [query, setQuery] = useState('')
  const [costs, setCosts] = useState(Object.fromEntries(Object.keys(FIELDS).map(k => [k, ''])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    getPlatforms().then(rows => { if (current) {setPlatforms(rows.filter(p => p.is_active))} })
      .catch(e => {if (current) {setError(errText(e, 'Could not load platforms'))}})
    return () => {current = false}
  }, [])
  const valid = platform && line.unit_cost > 0 && Object.values(costs).every(v => v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0) && Number(costs.gst) <= 100
  const save = async () => {
    if (busy || !valid) {return}
    setBusy(true); setError('')
    try {
      await createPricing({ sku_id: line.sku_id, platform_id: platform.id, price: line.unit_cost,
        ...Object.fromEntries(Object.entries(costs).map(([k, v]) => [k, Number(v)])) })
      onSave()
    } catch (e) {setError(errText(e, 'Could not set up pricing'))}
    finally {setBusy(false)}
  }
  return <ConfirmDialog open dialogRole="dialog" className="workflow-dialog" title="Set up cost from this bill"
    onCancel={() => !busy && onClose()} onConfirm={save} confirmLabel="Save cost & connect reports" confirmDisabled={busy || !valid}>
    <p>{line.sku_code}: purchase cost {line.unit_cost} per SKU unit, using the confirmed conversion {line.pack_multiple}.</p>
    <SmartCell label="Pricing platform" value={query} options={platforms.map(p => ({ ...p, label: p.name }))}
      onChange={value => {setQuery(value); setPlatform(null)}} onSelect={value => {setPlatform(value); setQuery(value.label)}} readOnly={busy} />
    {Object.entries(FIELDS).map(([key, label]) => <label className="input-group" key={key}>{label}
      <input aria-label={label} className="input" type="number" min="0" step="any" value={costs[key]} disabled={busy}
        onChange={e => setCosts(previous => ({ ...previous, [key]: e.target.value }))} />
    </label>)}
    <p>Enter each amount explicitly, including zero where appropriate. This bill supplies the purchase cost. Saving connects currently unpriced reports using these costs; existing frozen costs stay unchanged.</p>
    {error && <p role="alert">{error}</p>}
  </ConfirmDialog>
}
