import { useState } from 'react'
import './ManageCategoriesModal.css'

/**
 * ManageCategoriesModal
 * ──────────────────────────────────────────────────────────────────────
 * Each row shows: name + per-category defaults (CR%, Damage%, Profit%).
 * Defaults cascade to new SKUs in the category; per-SKU override still works.
 * Edit mode toggles inputs inline; Save commits via onUpdate(id, patch).
 */
export default function ManageCategoriesModal({ categories, rows, onClose, onUpdate, onDelete }) {
  const [editId,   setEditId]   = useState(null)
  const [draft,    setDraft]    = useState({})    // { name, default_cr_pct, default_damage_pct, default_profit_pct }
  const [busy,     setBusy]     = useState(null)

  const skuCount = cat =>
    rows.filter(r => r.categoryId === cat.id || r.category === cat.name).length

  const numOrNull = v => {
    if (v === '' || v === null || v === undefined) return null
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : null
  }

  const startEdit = cat => {
    setEditId(cat.id)
    setDraft({
      name:                 cat.name,
      default_cr_pct:       cat.default_cr_pct ?? '',
      default_damage_pct:   cat.default_damage_pct ?? '',
      default_profit_pct:   cat.default_profit_pct ?? '',
    })
  }
  const cancelEdit = () => { setEditId(null); setDraft({}) }

  const saveEdit = async cat => {
    if (!draft.name?.trim()) return cancelEdit()
    setBusy(cat.id)
    try {
      await onUpdate(cat.id, {
        name:                 draft.name.trim(),
        default_cr_pct:       numOrNull(draft.default_cr_pct),
        default_damage_pct:   numOrNull(draft.default_damage_pct),
        default_profit_pct:   numOrNull(draft.default_profit_pct),
      })
    } finally { setBusy(null); cancelEdit() }
  }

  const handleDelete = async cat => {
    if (skuCount(cat) > 0) return
    setBusy(cat.id)
    try { await onDelete(cat.id) } finally { setBusy(null) }
  }

  return (
    <div className="mc-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="mc-modal" style={{ width: 520 }}>
        <div className="mc-hdr">
          <span>Manage Categories</span>
          <button className="mc-close" onClick={onClose}>✕</button>
        </div>
        <div className="mc-body">
          {categories.length === 0 && (
            <div className="mc-empty">No categories yet.</div>
          )}
          {/* Column hints */}
          {categories.length > 0 && (
            <div className="mc-hints">
              <span style={{ flex: 1 }}>Name</span>
              <span className="mc-hint-pct">CR %</span>
              <span className="mc-hint-pct">Dmg %</span>
              <span className="mc-hint-pct">Profit %</span>
              <span style={{ width: 90 }} />
            </div>
          )}
          {categories.map(cat => {
            const count  = skuCount(cat)
            const isEdit = editId === cat.id
            const isBusy = busy === cat.id
            return (
              <div key={cat.id} className="mc-row">
                {isEdit ? (
                  <>
                    <input
                      className="mc-input"
                      value={draft.name}
                      autoFocus
                      onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                      onKeyDown={e => {
                        if (e.key === 'Enter')  saveEdit(cat)
                        if (e.key === 'Escape') cancelEdit()
                      }}
                    />
                    <input className="mc-pct-inp" type="number"
                      value={draft.default_cr_pct}
                      onChange={e => setDraft(d => ({ ...d, default_cr_pct: e.target.value }))} />
                    <input className="mc-pct-inp" type="number"
                      value={draft.default_damage_pct}
                      onChange={e => setDraft(d => ({ ...d, default_damage_pct: e.target.value }))} />
                    <input className="mc-pct-inp" type="number"
                      value={draft.default_profit_pct}
                      onChange={e => setDraft(d => ({ ...d, default_profit_pct: e.target.value }))} />
                  </>
                ) : (
                  <>
                    <span className="mc-name">{cat.name}</span>
                    <span className="mc-pct-show">{cat.default_cr_pct ?? '—'}</span>
                    <span className="mc-pct-show">{cat.default_damage_pct ?? '—'}</span>
                    <span className="mc-pct-show">{cat.default_profit_pct ?? '—'}</span>
                  </>
                )}
                <div className="mc-actions">
                  <span className={`mc-badge ${count > 0 ? 'mc-badge-used' : 'mc-badge-free'}`}>
                    {count > 0 ? `${count}` : '—'}
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
                      <button className="mc-btn mc-edit" onClick={() => startEdit(cat)} disabled={isBusy} title="Edit">✎</button>
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
