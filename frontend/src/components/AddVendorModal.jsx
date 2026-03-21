import { useState } from 'react'
import { createVendor } from '../api/client'

/**
 * AddVendorModal
 * 
 * Props:
 * - name: pre-filled vendor name (what user typed)
 * - onSave: called with the new vendor object after saving
 * - onClose: called when user cancels
 */
export default function AddVendorModal({ name, onSave, onClose }) {
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
      setError(err.response?.data?.detail || 'Error saving vendor')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 360 }}>

        <div className="modal-title">Add New Vendor</div>

        {/* Vendor name — read only, already typed */}
        <div className="input-group" style={{ marginBottom: 14 }}>
          <label>Vendor Name</label>
          <input
            className="input"
            value={name}
            readOnly
            style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
          />
        </div>

        {/* Short code — auto-generated but editable */}
        <div className="input-group" style={{ marginBottom: 6 }}>
          <label>Short Code *</label>
          <input
            className="input mono"
            value={shortCode}
            maxLength={6}
            placeholder="e.g. VRI"
            onChange={e => setShortCode(e.target.value.toUpperCase())}
            autoFocus
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

        <div className="form-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-gold"
            onClick={handleSave}
            disabled={saving || !shortCode.trim()}
          >
            {saving && (
              <span className="loader" style={{ width: 14, height: 14, borderWidth: 2 }} />
            )}
            Save Vendor
          </button>
        </div>

      </div>
    </div>
  )
}