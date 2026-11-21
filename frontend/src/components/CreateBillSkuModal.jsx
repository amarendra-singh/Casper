import { useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import { createSku, linkBillLine, errText } from '../api/client'

export default function CreateBillSkuModal({ line, bill, code, onCreated, onSave, onClose }) {
  const [skuCode, setSkuCode] = useState(code)
  const [vendorCode, setVendorCode] = useState('')
  const [pack, setPack] = useState('')
  const [created, setCreated] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const valid = skuCode.trim() && Number.isFinite(Number(pack)) && Number(pack) > 0

  const save = async () => {
    if (saving || !valid) {return}
    setSaving(true); setError('')
    let sku = created
    try {
      if (!sku) {
        sku = await createSku({ shringar_sku: skuCode.trim().toUpperCase(),
          vendor_sku: vendorCode.trim() || null, vendor_id: bill.vendor_id ?? null,
          description: line.item_name })
        setCreated(sku)
        onCreated(sku)
      }
      await linkBillLine(line.id, { sku_id: sku.id, pack_multiple: Number(pack), remember: true })
      onSave()
    } catch (e) {
      setError((sku ? 'SKU created, but linking failed. Retry linking without creating another SKU. ' : '') + errText(e, 'Could not save the SKU match.'))
    } finally {setSaving(false)}
  }

  return <ConfirmDialog open title="Create SKU for bill item" dialogRole="dialog"
    onCancel={() => !saving && onClose()} onConfirm={save}
    confirmLabel={saving ? 'Saving...' : created ? 'Retry linking' : 'Create & match'} confirmDisabled={saving || !valid}>
    <p>{line.item_name}</p>
    <p>Supplier: {bill.party_name || 'Not recorded'}</p>
    <label className="input-group">SKU code
      <input aria-label="SKU code" className="input" value={skuCode} disabled={saving || !!created} onChange={e => setSkuCode(e.target.value)} />
    </label>
    <label className="input-group">Vendor product code (optional)
      <input aria-label="Vendor product code (optional)" className="input" value={vendorCode} disabled={saving || !!created} onChange={e => setVendorCode(e.target.value)} />
    </label>
    <label className="input-group">SKU units per billed unit
      <input aria-label="SKU units per billed unit" className="input" type="number" min="0.000001" step="any" value={pack} disabled={saving} onChange={e => setPack(e.target.value)} />
    </label>
    <p className="bd-hint">Confirm the conversion: enter 1 if the billed unit is one complete SKU pack. Configure pricing separately in Unit Economics.</p>
    {error && <p role="alert" className="lg-error">{error}</p>}
  </ConfirmDialog>
}
