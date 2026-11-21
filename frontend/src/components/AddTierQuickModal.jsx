import ConfirmDialog from './ConfirmDialog'
import { useState, useId } from 'react'
import api, { errText } from '../api/client'

/**
 * AddTierQuickModal
 * ──────────────────────────────────────────────────────────────────────
 * Inline quick-add for a platform tier — invoked from the SKUs page tier
 * dropdown so the user doesn't have to leave for Settings.
 *
 * Props:
 *   platform      - the platform object (must include id, name)
 *   onSaved       - (newTier) => void   called after POST succeeds
 *   onClose       - () => void
 */
export default function AddTierQuickModal({ platform, onSaved, onClose }) {
  const fieldId0 = useId()
  const [name,   setName]   = useState('')
  const [mode,   setMode]   = useState('amt')   // 'amt' | 'pct'
  const [val,    setVal]    = useState('')
  const [busy,   setBusy]   = useState(false)
  const [error,  setError]  = useState('')

  const save = async () => {
    if (busy) {return}
    if (!name.trim()) { setError('Tier name is required'); return }
    if (val === '')   { setError('Enter a fee value');     return }
    setBusy(true); setError('')
    try {
      const isPct = mode === 'pct'
      const payload = {
        tier_name: name.trim(),
        fee:     isPct ? 0 : parseFloat(val),
        fee_pct: isPct ? parseFloat(val) : null,
      }
      const r = await api.post(`/platforms/${platform.id}/tiers`, payload)
      onSaved(r.data)
    } catch (e) {
      setError(errText(e, 'Error saving tier'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog open title="Add Tier" dialogRole="dialog"
      onCancel={() => !busy && onClose()} onConfirm={save}
      confirmLabel="Add Tier" confirmDisabled={busy || !name.trim() || val === ''}>

        <div className="input-group" style={{ marginBottom: 8 }}>
          <label htmlFor={fieldId0 + '-field-50'}>Tier name *</label>
          <input id={fieldId0 + '-field-50'} aria-label="Tier name" className="input" value={name}
            placeholder="e.g. Gold, Standard, Premium"
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8, marginBottom: 8 }}>
          <div className="input-group">
            <label htmlFor={fieldId0 + '-field-59'}>Mode</label>
            <select id={fieldId0 + '-field-59'} aria-label="Fee mode" className="input" value={mode} onChange={e => setMode(e.target.value)}>
              <option value="amt">₹</option>
              <option value="pct">%</option>
            </select>
          </div>
          <div className="input-group">
            <label>{mode === 'pct' ? '% of base BS' : 'Fee in ₹'}</label>
            <input aria-label="Tier fee" className="input" type="number" value={val}
              placeholder={mode === 'pct' ? '10' : '12'}
              onChange={e => setVal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && save()} />
          </div>
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10 }}>
          {mode === 'pct'
            ? `Fee = (Target Pre-GST + GST) × ${val || 0}%`
            : `Flat ₹${val || 0} added to listing price.`}
        </div>

        {error && (
          <div style={{
            padding: '6px 10px', background: 'var(--red-dim)',
            border: '1px solid var(--red)', borderRadius: 'var(--radius-sm)',
            color: 'var(--red)', fontSize: 12, marginBottom: 10,
          }}>{error}</div>
        )}

    </ConfirmDialog>
  )
}
