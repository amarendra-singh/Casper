import { useState, useEffect } from 'react'
import { getVendors, updateVendor, deleteVendor, createVendor, getEntries } from '../api/client'
import './Vendors.css'

export default function Vendors() {
  const [vendors,  setVendors]  = useState([])
  const [skuCounts, setSkuCounts] = useState({}) // { vendorId: count }
  const [loading,  setLoading]  = useState(true)
  const [editId,   setEditId]   = useState(null)
  const [editName, setEditName] = useState('')
  const [editCode, setEditCode] = useState('')
  const [busy,     setBusy]     = useState(null)
  const [showAdd,  setShowAdd]  = useState(false)
  const [newName,  setNewName]  = useState('')
  const [newCode,  setNewCode]  = useState('')
  const [error,    setError]    = useState('')

  useEffect(() => {
    Promise.all([getVendors(), getEntries()]).then(([vs, entries]) => {
      setVendors(vs)
      const counts = {}
      entries.forEach(e => { if (e.vendor_id) counts[e.vendor_id] = (counts[e.vendor_id] || 0) + 1 })
      setSkuCounts(counts)
      setLoading(false)
    })
  }, [])

  const startEdit = v => { setEditId(v.id); setEditName(v.name); setEditCode(v.short_code) }
  const cancelEdit = () => { setEditId(null); setEditName(''); setEditCode('') }

  const saveEdit = async v => {
    if (!editName.trim()) return
    setBusy(v.id)
    try {
      const updated = await updateVendor(v.id, { name: editName.trim(), short_code: editCode.trim().toUpperCase() })
      setVendors(p => p.map(x => x.id === v.id ? updated : x))
      cancelEdit()
    } catch(e) {
      setError(e.response?.data?.detail || 'Update failed')
    } finally { setBusy(null) }
  }

  const handleDelete = async v => {
    if ((skuCounts[v.id] || 0) > 0) return
    if (!confirm(`Delete vendor "${v.name}"?`)) return
    setBusy(v.id)
    try {
      await deleteVendor(v.id)
      setVendors(p => p.filter(x => x.id !== v.id))
    } catch(e) {
      setError(e.response?.data?.detail || 'Delete failed')
    } finally { setBusy(null) }
  }

  const handleAdd = async () => {
    if (!newName.trim() || !newCode.trim()) return
    setBusy('new')
    try {
      const created = await createVendor({ name: newName.trim(), short_code: newCode.trim().toUpperCase() })
      setVendors(p => [...p, created])
      setNewName(''); setNewCode(''); setShowAdd(false)
    } catch(e) {
      setError(e.response?.data?.detail || 'Create failed')
    } finally { setBusy(null) }
  }

  if (loading) return <div className="vnd-loading"><div className="loader" /></div>

  return (
    <div className="vnd-page">
      <div className="vnd-header">
        <div>
          <h1 className="vnd-title">Vendors</h1>
          <p className="vnd-sub">{vendors.length} vendor{vendors.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn btn-accent" onClick={() => { setShowAdd(true); setError('') }}>
          + Add Vendor
        </button>
      </div>

      {error && <div className="vnd-error">{error} <button onClick={() => setError('')}>✕</button></div>}

      {showAdd && (
        <div className="vnd-add-row">
          <input className="vnd-inp" placeholder="Vendor name" value={newName}
            autoFocus onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setShowAdd(false) }} />
          <input className="vnd-inp vnd-inp-short" placeholder="Short code" value={newCode}
            onChange={e => setNewCode(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setShowAdd(false) }} />
          <button className="btn btn-accent" onClick={handleAdd} disabled={busy === 'new'}>
            {busy === 'new' ? '…' : 'Save'}
          </button>
          <button className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
        </div>
      )}

      <div className="vnd-table-wrap">
        <table className="vnd-table">
          <thead>
            <tr>
              <th>Vendor Name</th>
              <th>Short Code</th>
              <th>SKUs</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {vendors.map(v => {
              const count  = skuCounts[v.id] || 0
              const isEdit = editId === v.id
              const isBusy = busy === v.id
              return (
                <tr key={v.id}>
                  <td>
                    {isEdit
                      ? <input className="vnd-inp" value={editName} autoFocus
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(v); if (e.key === 'Escape') cancelEdit() }} />
                      : <span className="vnd-name">{v.name}</span>
                    }
                  </td>
                  <td>
                    {isEdit
                      ? <input className="vnd-inp vnd-inp-short" value={editCode}
                          onChange={e => setEditCode(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(v); if (e.key === 'Escape') cancelEdit() }} />
                      : <span className="vnd-code">{v.short_code}</span>
                    }
                  </td>
                  <td>
                    <span className={`vnd-badge ${count > 0 ? 'vnd-badge-used' : 'vnd-badge-free'}`}>
                      {count > 0 ? `${count} SKU${count > 1 ? 's' : ''}` : 'unused'}
                    </span>
                  </td>
                  <td>
                    <span className={`vnd-badge ${v.is_active ? 'vnd-badge-active' : 'vnd-badge-inactive'}`}>
                      {v.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div className="vnd-actions">
                      {isEdit ? (
                        <>
                          <button className="vnd-btn vnd-save" onClick={() => saveEdit(v)} disabled={isBusy}>
                            {isBusy ? '…' : '✓ Save'}
                          </button>
                          <button className="vnd-btn vnd-cancel" onClick={cancelEdit}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button className="vnd-btn vnd-edit" onClick={() => startEdit(v)} disabled={isBusy}>
                            ✎ Edit
                          </button>
                          <button
                            className="vnd-btn vnd-del"
                            onClick={() => handleDelete(v)}
                            disabled={count > 0 || isBusy}
                            title={count > 0 ? `Used by ${count} SKU(s) — cannot delete` : 'Delete vendor'}
                          >
                            {isBusy ? '…' : '✕ Delete'}
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
      </div>
    </div>
  )
}
