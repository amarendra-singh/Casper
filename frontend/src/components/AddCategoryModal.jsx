import { useState } from 'react'
import { createCategory } from '../api/client'

/**
 * AddCategoryModal
 * 
 * Props:
 * - name: pre-filled category name
 * - onSave: called with new category object
 * - onClose: cancel handler
 */
export default function AddCategoryModal({ name, onSave, onClose }) {
  const [catName, setCatName] = useState(name)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const handleSave = async () => {
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
      })
      onSave(category)
    } catch (err) {
      setError(err.response?.data?.detail || 'Error saving category')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 340 }}>

        <div className="modal-title">Add New Category</div>

        <div className="input-group" style={{ marginBottom: 6 }}>
          <label>Category Name *</label>
          <input
            className="input"
            value={catName}
            onChange={e => setCatName(e.target.value)}
            autoFocus
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
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
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-gold"
            onClick={handleSave}
            disabled={saving || !catName.trim()}
          >
            {saving && (
              <span className="loader" style={{ width: 14, height: 14, borderWidth: 2 }} />
            )}
            Save Category
          </button>
        </div>

      </div>
    </div>
  )
}