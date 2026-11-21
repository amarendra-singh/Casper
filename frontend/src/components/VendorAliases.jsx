import { useEffect, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import api, { errText } from '../api/client'
import { useCompany } from '../context/CompanyContext'

export default function VendorAliases({ vendor, onClose }) {
  const { role, isAll } = useCompany()
  const canWrite = !isAll && ['owner', 'admin'].includes(role)
  const [aliases, setAliases] = useState([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    api.get(`/vendors/${vendor.id}/aliases`).then(r => {if (current) {setAliases(r.data)}})
      .catch(e => {if (current) {setError(errText(e, 'Could not load supplier names'))}})
    return () => {current = false}
  }, [vendor.id])
  const change = async removeId => {
    if (busy || !canWrite) {return}
    setBusy(true); setError('')
    try {
      if (removeId) {await api.delete(`/vendors/${vendor.id}/aliases/${removeId}`)}
      else {await api.post(`/vendors/${vendor.id}/aliases`, { name: name.trim() })}
      setAliases((await api.get(`/vendors/${vendor.id}/aliases`)).data); setName('')
    } catch (e) {setError(errText(e, 'Could not save supplier name'))}
    finally {setBusy(false)}
  }
  return <ConfirmDialog open dialogRole="dialog" className="workflow-dialog" title={`Supplier names: ${vendor.name}`} onCancel={() => !busy && onClose()}
    onConfirm={() => change()} confirmLabel="Add name" confirmDisabled={busy || !canWrite || !name.trim()}>
    <p>These exact names identify this supplier on future imports. Saved bills and confirmed item mappings are retained when a name is removed.</p>
    <label>Alternate supplier name<input aria-label="Alternate supplier name" maxLength={150} disabled={!canWrite || busy} value={name} onChange={e => setName(e.target.value)} /></label>
    <ul>{aliases.map(alias => <li key={alias.id}>{alias.name} <button disabled={busy || !canWrite} onClick={() => change(alias.id)}>Remove {alias.name}</button></li>)}</ul>
    {error && <p role="alert">{error}</p>}
  </ConfirmDialog>
}
