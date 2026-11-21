import VendorAliases from '../components/VendorAliases'
import { useState, useEffect } from 'react'
import { getVendors, updateVendor, deleteVendor, createVendor, getEntries, errText } from '../api/client'
import './Vendors.css'
import { useConfirm } from '../components/ConfirmDialog'

export default function Vendors() {
  const { ask, dialog } = useConfirm()
  const [aliasVendor, setAliasVendor] = useState(null)
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
      entries.forEach(e => { if (e.vendor_id) {counts[e.vendor_id] = (counts[e.vendor_id] || 0) + 1} })
      setSkuCounts(counts)
      setLoading(false)
    }).catch(e => {setError(errText(e, "Could not load vendors")); setLoading(false)})
  }, [])

  const startEdit = v => { setEditId(v.id); setEditName(v.name); setEditCode(v.short_code) }
  const cancelEdit = () => { setEditId(null); setEditName(''); setEditCode('') }

  const saveEdit = async v => {
    if (!editName.trim()) {return}
    setBusy(v.id)
    try {
      const updated = await updateVendor(v.id, { name: editName.trim(), short_code: editCode.trim().toUpperCase() })
      setVendors(p => p.map(x => x.id === v.id ? updated : x))
      cancelEdit()
    } catch(e) {
      setError(errText(e, 'Update failed'))
    } finally { setBusy(null) }
  }

  const handleDelete = v => {
    if ((skuCounts[v.id] || 0) > 0) {
      setError(`Cannot delete "${v.name}" — it has ${skuCounts[v.id]} active SKU(s). Remove or reassign them first.`)
      return
    }
    ask({
      title: 'Delete vendor',
      body: <>Delete vendor <strong>{v.name}</strong>?
        <span className="cd-note">This cannot be undone.</span></>,
      confirmLabel: 'Delete vendor', tone: 'danger',
      onConfirm: () => doDelete(v),
    })
  }

  const doDelete = async v => {
    setBusy(v.id)
    try {
      await deleteVendor(v.id)
      setVendors(p => p.filter(x => x.id !== v.id))
    } catch(e) {
      setError(errText(e, 'Delete failed'))
    } finally { setBusy(null) }
  }

  const handleAdd = async () => {
    if (!newName.trim() || !newCode.trim()) {return}
    setBusy('new')
    try {
      const created = await createVendor({ name: newName.trim(), short_code: newCode.trim().toUpperCase() })
      setVendors(p => [...p, created])
      setNewName(''); setNewCode(''); setShowAdd(false)
    } catch(e) {
      setError(errText(e, 'Create failed'))
    } finally { setBusy(null) }
  }

  if (loading) {return <div className="vnd-loading"><div className="loader" /></div>}

  return (
    <div className="vnd-page">
      {dialog}
      {aliasVendor && <VendorAliases vendor={aliasVendor} onClose={() => setAliasVendor(null)} />}
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
          <input aria-label="Vendor name" className="vnd-inp" placeholder="Vendor name" value={newName}
             onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') {handleAdd();} if (e.key === 'Escape') {setShowAdd(false)} }} />
          <input aria-label="Short code" className="vnd-inp vnd-inp-short" placeholder="Short code" value={newCode}
            onChange={e => setNewCode(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') {handleAdd();} if (e.key === 'Escape') {setShowAdd(false)} }} />
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
                      ? <input aria-label={"Vendor name"} className="vnd-inp" value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') {saveEdit(v);} if (e.key === 'Escape') {cancelEdit()} }} />
                      : <span className="vnd-name">{v.name}</span>
                    }
                  </td>
                  <td>
                    {isEdit
                      ? <input aria-label={"Vendor short code"} className="vnd-inp vnd-inp-short" value={editCode}
                          onChange={e => setEditCode(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') {saveEdit(v);} if (e.key === 'Escape') {cancelEdit()} }} />
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
                      <button className="vnd-btn" onClick={() => setAliasVendor(v)}>Supplier names</button>
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
