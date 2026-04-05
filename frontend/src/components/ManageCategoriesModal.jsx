import { useState } from 'react'
import './ManageCategoriesModal.css'

export default function ManageCategoriesModal({ categories, rows, onClose, onUpdate, onDelete }) {
  const [editId,  setEditId]  = useState(null)
  const [editVal, setEditVal] = useState('')
  const [busy,    setBusy]    = useState(null) // id being saved/deleted

  // Count how many saved rows use each category
  const skuCount = cat =>
    rows.filter(r => r.categoryId === cat.id || r.category === cat.name).length

  const startEdit = cat => { setEditId(cat.id); setEditVal(cat.name) }
  const cancelEdit = () => { setEditId(null); setEditVal('') }

  const saveEdit = async cat => {
    if (!editVal.trim() || editVal === cat.name) return cancelEdit()
    setBusy(cat.id)
    try { await onUpdate(cat.id, editVal.trim()) } finally { setBusy(null); cancelEdit() }
  }

  const handleDelete = async cat => {
    if (skuCount(cat) > 0) return
    setBusy(cat.id)
    try { await onDelete(cat.id) } finally { setBusy(null) }
  }

  return (
    <div className="mc-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="mc-modal">
        <div className="mc-hdr">
          <span>Manage Categories</span>
          <button className="mc-close" onClick={onClose}>✕</button>
        </div>
        <div className="mc-body">
          {categories.length === 0 && (
            <div className="mc-empty">No categories yet.</div>
          )}
          {categories.map(cat => {
            const count  = skuCount(cat)
            const isEdit = editId === cat.id
            const isBusy = busy === cat.id
            return (
              <div key={cat.id} className="mc-row">
                {isEdit ? (
                  <input
                    className="mc-input"
                    value={editVal}
                    autoFocus
                    onChange={e => setEditVal(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter')  saveEdit(cat)
                      if (e.key === 'Escape') cancelEdit()
                    }}
                  />
                ) : (
                  <span className="mc-name">{cat.name}</span>
                )}
                <div className="mc-actions">
                  <span className={`mc-badge ${count > 0 ? 'mc-badge-used' : 'mc-badge-free'}`}>
                    {count > 0 ? `${count} SKU${count > 1 ? 's' : ''}` : 'unused'}
                  </span>
                  {isEdit ? (
                    <>
                      <button className="mc-btn mc-save" onClick={() => saveEdit(cat)} disabled={isBusy}>
                        {isBusy ? '…' : '✓'}
                      </button>
                      <button className="mc-btn mc-cancel" onClick={cancelEdit}>✕</button>
                    </>
                  ) : (
                    <>
                      <button className="mc-btn mc-edit" onClick={() => startEdit(cat)} disabled={isBusy} title="Rename">✎</button>
                      <button
                        className="mc-btn mc-del"
                        onClick={() => handleDelete(cat)}
                        disabled={count > 0 || isBusy}
                        title={count > 0 ? 'In use — cannot delete' : 'Delete'}
                      >{isBusy ? '…' : '✕'}</button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
