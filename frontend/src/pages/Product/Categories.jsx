import { useState, useEffect, useCallback } from 'react'
import {
  getCategories, getEntries,
  updateCategory, deleteCategory
} from '../../api/client'
import AddCategoryModal from '../../components/AddCategoryModal'
import './Product.css'

export default function Categories() {
  const [categories, setCategories] = useState([])
  const [rows, setRows]             = useState([])
  const [loading, setLoading]       = useState(true)
  const [editId, setEditId]         = useState(null)
  const [draft, setDraft]           = useState({})
  const [busy, setBusy]             = useState(null)
  const [addModal, setAddModal]     = useState(false)

  useEffect(() => {
    Promise.all([getCategories(), getEntries()])
      .then(([cats, entries]) => {
        setCategories(cats.filter(c => c.is_active))
        setRows(entries)
      })
      .finally(() => setLoading(false))
  }, [])

  const skuCount = useCallback(
    cat => rows.filter(r => r.category_id === cat.id || r.category_name === cat.name).length,
    [rows]
  )

  const numOrNull = v => {
    if (v === '' || v === null || v === undefined) {return null}
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : null
  }

  const startEdit = cat => {
    setEditId(cat.id)
    setDraft({
      name:               cat.name,
      default_cr_pct:     cat.default_cr_pct ?? '',
      default_damage_pct: cat.default_damage_pct ?? '',
      default_profit_pct: cat.default_profit_pct ?? '',
    })
  }

  const cancelEdit = () => { setEditId(null); setDraft({}) }

  const saveEdit = async cat => {
    if (!draft.name?.trim()) {return cancelEdit()}
    setBusy(cat.id)
    try {
      await updateCategory(cat.id, {
        name:               draft.name.trim(),
        default_cr_pct:     numOrNull(draft.default_cr_pct),
        default_damage_pct: numOrNull(draft.default_damage_pct),
        default_profit_pct: numOrNull(draft.default_profit_pct),
      })
      setCategories(p => p.map(c => c.id === cat.id ? { ...c, ...draft, name: draft.name.trim() } : c))
    } finally {
      setBusy(null)
      cancelEdit()
    }
  }

  const handleDelete = async cat => {
    if (skuCount(cat) > 0) {return}
    setBusy(cat.id)
    try {
      await deleteCategory(cat.id)
      setCategories(p => p.filter(c => c.id !== cat.id))
    } finally { setBusy(null) }
  }

  const handleCatSaved = c => {
    setCategories(p => [...p, c])
    setAddModal(false)
  }

  if (loading) {return (
    <div className="loader-page">
      <div className="loader" style={{ width: 32, height: 32 }} />
    </div>
  )}

  return (
    <div className="cat-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Categories</h1>
          <p className="page-subtitle">{categories.length} categories</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAddModal(true)}>
          + Add Category
        </button>
      </div>

      {categories.length === 0 ? (
        <div className="cat-empty">
          No categories yet. Create one to set default CR%, Damage%, and Profit% for SKU groups.
        </div>
      ) : (
        <table className="cat-tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th style={{ width: 80, textAlign: 'right' }}>CR %</th>
              <th style={{ width: 80, textAlign: 'right' }}>Damage %</th>
              <th style={{ width: 80, textAlign: 'right' }}>Profit %</th>
              <th style={{ width: 70, textAlign: 'center' }}>SKUs</th>
              <th style={{ width: 120 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {categories.map(cat => {
              const count  = skuCount(cat)
              const isEdit = editId === cat.id
              const isBusy = busy === cat.id
              return (
                <tr key={cat.id}>
                  <td>
                    {isEdit ? (
                      <input aria-label={"Category name"}
                        className="cat-name-inp"
                        value={draft.name}

                        onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {saveEdit(cat)}
                          if (e.key === 'Escape') {cancelEdit()}
                        }}
                      />
                    ) : (
                      <span className="cat-name">{cat.name}</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {isEdit ? (
                      <input aria-label={"Category return percentage"} className="cat-inp" type="number" value={draft.default_cr_pct}
                        onChange={e => setDraft(d => ({ ...d, default_cr_pct: e.target.value }))} />
                    ) : (
                      cat.default_cr_pct ?? '—'
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {isEdit ? (
                      <input aria-label={"Category damage percentage"} className="cat-inp" type="number" value={draft.default_damage_pct}
                        onChange={e => setDraft(d => ({ ...d, default_damage_pct: e.target.value }))} />
                    ) : (
                      cat.default_damage_pct ?? '—'
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {isEdit ? (
                      <input aria-label={"Category profit percentage"} className="cat-inp" type="number" value={draft.default_profit_pct}
                        onChange={e => setDraft(d => ({ ...d, default_profit_pct: e.target.value }))} />
                    ) : (
                      cat.default_profit_pct ?? '—'
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span className="cat-count">{count}</span>
                  </td>
                  <td>
                    <div className="cat-actions">
                      {isEdit ? (
                        <>
                          <button className="cat-btn save" onClick={() => saveEdit(cat)} disabled={isBusy}>
                            {isBusy ? '...' : 'Save'}
                          </button>
                          <button className="cat-btn" onClick={cancelEdit}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button className="cat-btn" onClick={() => startEdit(cat)} disabled={isBusy}>
                            Edit
                          </button>
                          <button
                            className="cat-btn danger"
                            onClick={() => handleDelete(cat)}
                            disabled={count > 0 || isBusy}
                            title={count > 0 ? 'In use — cannot delete' : 'Delete'}
                          >
                            {isBusy ? '...' : 'Delete'}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {addModal && (
        <AddCategoryModal
          name=""
          onSave={handleCatSaved}
          onClose={() => setAddModal(false)}
        />
      )}
    </div>
  )
}
