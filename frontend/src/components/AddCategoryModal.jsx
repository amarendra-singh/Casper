import ConfirmDialog from './ConfirmDialog'
import { useState, useId } from 'react'
import { createCategory, errText } from '../api/client'

/**
 * AddCategoryModal
 *
 * Props:
 * - name: pre-filled category name
 * - onSave: called with new category object
 * - onClose: cancel handler
 */
export default function AddCategoryModal({ name, onSave, onClose }) {
  const fieldId0 = useId()
  const [catName, setCatName] = useState(name)
  const [crPct,   setCrPct]   = useState('20')   // jewellery default
  const [dmgPct,  setDmgPct]  = useState('15')
  const [profPct, setProfPct] = useState('20')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const numOrNull = v => {
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : null
  }

  const handleSave = async () => {
    if (saving) {return}
    if (!catName.trim()) {
      setError('Category name is required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const category = await createCategory({
        name: catName.trim(),
        is_active: true,
        default_cr_pct:     numOrNull(crPct),
        default_damage_pct: numOrNull(dmgPct),
        default_profit_pct: numOrNull(profPct),
      })
      onSave(category)
    } catch (err) {
      setError(errText(err, 'Error saving category'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ConfirmDialog open title="Add New Category" dialogRole="dialog"
      onCancel={() => !saving && onClose()} onConfirm={handleSave}
      confirmLabel="Save Category" confirmDisabled={saving || !catName.trim()}>

        <div className="input-group" style={{ marginBottom: 6 }}>
          <label htmlFor={fieldId0 + '-field-56'}>Category Name *</label>
          <input aria-label={"Category Name *"} id={fieldId0 + '-field-56'}
            className="input"
            value={catName}
            onChange={e => setCatName(e.target.value)}

            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
          gap: 8, marginBottom: 6,
        }}>
          <div className="input-group">
            <label htmlFor={fieldId0 + '-field-71'}>Default CR %</label>
            <input id={fieldId0 + '-field-71'} aria-label="Default CR %" className="input" type="number" value={crPct}
              onChange={e => setCrPct(e.target.value)} placeholder="20" />
          </div>
          <div className="input-group">
            <label htmlFor={fieldId0 + '-field-76'}>Default Dmg %</label>
            <input id={fieldId0 + '-field-76'} aria-label="Default Dmg %" className="input" type="number" value={dmgPct}
              onChange={e => setDmgPct(e.target.value)} placeholder="15" />
          </div>
          <div className="input-group">
            <label htmlFor={fieldId0 + '-field-81'}>Default Profit %</label>
            <input id={fieldId0 + '-field-81'} aria-label="Default Profit %" className="input" type="number" value={profPct}
              onChange={e => setProfPct(e.target.value)} placeholder="20" />
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10 }}>
          New SKUs in this category auto-fill these values. Override per SKU still works.
        </div>

        {error && (
          <div style={{
            padding: '8px 12px', background: 'var(--red-dim)',
            border: '1px solid var(--red)', borderRadius: 'var(--radius-sm)',
            color: 'var(--red)', fontSize: 12, marginBottom: 10
          }}>
            {error}
          </div>
        )}

    </ConfirmDialog>
  )
}
