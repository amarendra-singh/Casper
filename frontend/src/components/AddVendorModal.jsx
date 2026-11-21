import ConfirmDialog from './ConfirmDialog'
import { useState, useId } from 'react'
import { createVendor, errText } from '../api/client'

/**
 * AddVendorModal
 *
 * Props:
 * - name: pre-filled vendor name (what user typed)
 * - onSave: called with the new vendor object after saving
 * - onClose: called when user cancels
 */
export default function AddVendorModal({ name, onSave, onClose }) {
  const fieldId0 = useId()
  // Auto-generate short code from name
  // e.g. "Varni Sales" → "VRS", "Glowroad" → "GLW"
  const autoCode = name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 4)

  const [shortCode, setShortCode] = useState(autoCode)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  const handleSave = async () => {
    if (saving) {return}
    if (!shortCode.trim()) {
      setError('Short code is required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const vendor = await createVendor({
        name: name.trim(),
        short_code: shortCode.trim().toUpperCase(),
        is_active: true,
      })
      onSave(vendor) // pass saved vendor back to parent
    } catch (err) {
      setError(errText(err, 'Error saving vendor'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ConfirmDialog open title="Add New Vendor" dialogRole="dialog"
      onCancel={() => !saving && onClose()} onConfirm={handleSave}
      confirmLabel="Save Vendor" confirmDisabled={saving || !shortCode.trim()}>

        {/* Vendor name — read only, already typed */}
        <div className="input-group" style={{ marginBottom: 14 }}>
          <label htmlFor={fieldId0 + '-field-56'}>Vendor Name</label>
          <input aria-label={"Vendor Name"} id={fieldId0 + '-field-56'}
            className="input"
            value={name}
            readOnly
            style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
          />
        </div>

        {/* Short code — auto-generated but editable */}
        <div className="input-group" style={{ marginBottom: 6 }}>
          <label htmlFor={fieldId0 + '-field-67'}>Short Code *</label>
          <input aria-label={"Short Code *"} id={fieldId0 + '-field-67'}
            className="input mono"
            value={shortCode}
            maxLength={6}
            placeholder="e.g. VRI"
            onChange={e => setShortCode(e.target.value.toUpperCase())}

            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
          <span style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>
            Auto-generated from name — edit if needed. Max 6 characters.
          </span>
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
