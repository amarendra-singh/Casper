import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSkus, createSku, updateSku, deleteSku, getVendors, getCategories } from '../api/client'
import './SKUs.css'

function Toast({ msg, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t) }, [])
  return <div className={`toast toast-${type}`}>{msg}</div>
}

const EMPTY = { shringar_sku: '', description: '', vendor_id: '', category_id: '', is_active: true }

export default function SKUs() {
  const navigate              = useNavigate()
  const [skus, setSkus]       = useState([])
  const [vendors, setVendors] = useState([])
  const [cats, setCats]       = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [modal, setModal]     = useState(null)
  const [form, setForm]       = useState(EMPTY)
  const [editId, setEditId]   = useState(null)
  const [saving, setSaving]   = useState(false)
  const [toast, setToast]     = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  const load = () => {
    setLoading(true)
    Promise.all([getSkus(), getVendors(), getCategories()])
      .then(([s, v, c]) => { setSkus(s); setVendors(v); setCats(c) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const showToast = (msg, type = 'success') => setToast({ msg, type })

  const openCreate = () => { setForm(EMPTY); setEditId(null); setModal('create') }
  const openEdit = (sku) => {
    setForm({
      shringar_sku: sku.shringar_sku,
      description:  sku.description || '',
      vendor_id:    sku.vendor_id || '',
      category_id:  sku.category_id || '',
      is_active:    sku.is_active,
    })
    setEditId(sku.id)
    setModal('edit')
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = {
        ...form,
        vendor_id:   form.vendor_id   ? parseInt(form.vendor_id)   : null,
        category_id: form.category_id ? parseInt(form.category_id) : null,
      }
      if (modal === 'create') {
        await createSku(payload)
        showToast('SKU created successfully')
      } else {
        await updateSku(editId, payload)
        showToast('SKU updated successfully')
      }
      setModal(null)
      load()
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error saving SKU', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await deleteSku(id)
      showToast('SKU deleted')
      setDeleteConfirm(null)
      load()
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error deleting', 'error')
    }
  }

  const filtered = skus.filter(s =>
    s.shringar_sku.toLowerCase().includes(search.toLowerCase()) ||
    (s.description || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.vendor?.name || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="skus-page">
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title">SKUs</h1>
          <p className="page-subtitle">
            {skus.length} total · {skus.filter(s => s.is_active).length} active
          </p>
        </div>
        <button className="btn btn-gold" onClick={openCreate}>+ New SKU</button>
      </div>

      <div style={{ marginBottom:18 }}>
        <input className="input" style={{ maxWidth:360 }}
          placeholder="Search by SKU, description, vendor…"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="loader-page"><div className="loader" style={{ width:32, height:32 }} /></div>
      ) : (
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>SKU Code</th>
                  <th>Description</th>
                  <th>Vendor</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign:'center', padding:'40px', color:'var(--text-3)' }}>
                      {search ? 'No SKUs match your search' : 'No SKUs yet — create one!'}
                    </td>
                  </tr>
                ) : filtered.map((sku, i) => (
                  <tr key={sku.id}>
                    <td style={{ color:'var(--text-3)', width:40 }}>{i + 1}</td>
                    <td>
                      <span className="mono sku-code"
                        onClick={() => navigate(`/pricing/${sku.id}`)}>
                        {sku.shringar_sku}
                      </span>
                    </td>
                    <td>{sku.description || <span style={{ color:'var(--text-3)' }}>—</span>}</td>
                    <td>{sku.vendor?.name || <span style={{ color:'var(--text-3)' }}>—</span>}</td>
                    <td>{sku.category?.name || <span style={{ color:'var(--text-3)' }}>—</span>}</td>
                    <td>
                      <span className={`badge ${sku.is_active ? 'badge-green' : 'badge-red'}`}>
                        {sku.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display:'flex', gap:6 }}>
                        <button className="btn btn-ghost btn-sm"
                          onClick={() => navigate(`/pricing/${sku.id}`)}>Pricing</button>
                        <button className="btn btn-ghost btn-sm"
                          onClick={() => openEdit(sku)}>Edit</button>
                        <button className="btn btn-danger btn-sm"
                          onClick={() => setDeleteConfirm(sku)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      {modal && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <div className="modal-title">{modal === 'create' ? 'New SKU' : 'Edit SKU'}</div>
            <div className="form-grid">
              <div className="input-group span-2">
                <label>SKU Code *</label>
                <input className="input mono" placeholder="SHJ-JS-VRI-N5-GREEN"
                  value={form.shringar_sku}
                  onChange={e => setForm(f => ({ ...f, shringar_sku: e.target.value.toUpperCase() }))} />
                <span style={{ fontSize:11, color:'var(--text-3)', marginTop:3 }}>
                  Format: SHJ-CATEGORY-VENDOR-PRODUCT
                </span>
              </div>
              <div className="input-group span-2">
                <label>Description</label>
                <input className="input" placeholder="Product description"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="input-group">
                <label>Vendor</label>
                <select className="input" value={form.vendor_id}
                  onChange={e => setForm(f => ({ ...f, vendor_id: e.target.value }))}>
                  <option value="">— Select Vendor —</option>
                  {vendors.filter(v => v.is_active).map(v => (
                    <option key={v.id} value={v.id}>{v.name} ({v.short_code})</option>
                  ))}
                </select>
              </div>
              <div className="input-group">
                <label>Category</label>
                <select className="input" value={form.category_id}
                  onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
                  <option value="">— Select Category —</option>
                  {cats.filter(c => c.is_active).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="input-group span-2">
                <label>Status</label>
                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:'var(--text-2)' }}>
                  <input type="checkbox" checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                    style={{ accentColor:'var(--gold)', width:14, height:14 }} />
                  {form.is_active ? 'Active' : 'Inactive'}
                </label>
              </div>
            </div>
            <div className="form-actions">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-gold" onClick={handleSave}
                disabled={saving || !form.shringar_sku}>
                {saving && <span className="loader" style={{ width:14, height:14, borderWidth:2 }} />}
                {modal === 'create' ? 'Create SKU' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setDeleteConfirm(null)}>
          <div className="modal" style={{ maxWidth:380 }}>
            <div className="modal-title" style={{ color:'var(--red)' }}>Delete SKU?</div>
            <p style={{ color:'var(--text-2)', fontSize:14, marginBottom:20 }}>
              Delete <strong className="mono" style={{ color:'var(--text)' }}>{deleteConfirm.shringar_sku}</strong>?
              This also removes all its pricing data and cannot be undone.
            </p>
            <div className="form-actions">
              <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm.id)}>
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}