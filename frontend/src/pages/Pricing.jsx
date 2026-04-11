import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getSkus, getPlatforms, getPricingForSku, createPricing, updatePricing, deletePricing } from '../api/client'
import './Pricing.css'

function Toast({ msg, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t) }, [])
  return <div className={`toast toast-${type}`}>{msg}</div>
}

const EMPTY = {
  platform_id: '', price: '', package: '', logistics: '',
  addons: 0, cr_percentage: 10, cr_cost: '',
  damage_percentage: 15, damage_cost: '', misc_total: '', gst: 0,
}

function PricingCard({ row, platform, onEdit, onDelete }) {
  return (
    <div className="pricing-card">
      <div className="pc-header">
        <span className="pc-platform">{platform?.name ?? 'Unknown'}</span>
        <span className={`badge ${row.is_active ? 'badge-green' : 'badge-red'}`}>
          {row.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div className="pc-grid">
        {[
          ['Price',     `₹${row.price}`],
          ['Package',   `₹${row.package}`],
          ['Logistics', `₹${row.logistics}`],
          ['Addons',    `₹${row.addons}`],
          ['Misc',      `₹${row.misc_total}`],
          ['CR Cost',   `₹${row.cr_cost}`, `${row.cr_percentage}%`],
          ['Damage',    `₹${row.damage_cost}`, `${row.damage_percentage}%`],
          ['GST',       `₹${row.gst}`],
        ].map(([label, val, sub]) => (
          <div key={label} className="pc-cell">
            <div className="pc-cell-label">{label}</div>
            <div className="pc-cell-value mono">{val}</div>
            {sub && <div className="pc-cell-sub">{sub}</div>}
          </div>
        ))}
      </div>

      <div className="pc-results">
        <div className="pc-result">
          <span className="pc-result-label">Breakeven</span>
          <span className="pc-result-value mono">₹{row.breakeven}</span>
        </div>
        <div className="pc-result pc-result--gold">
          <span className="pc-result-label">Bank Settlement</span>
          <span className="pc-result-value mono gold">₹{row.bank_settlement}</span>
        </div>
      </div>

      <div className="pc-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => onEdit(row)}>Edit</button>
        <button className="btn btn-danger btn-sm" onClick={() => onDelete(row)}>Remove</button>
      </div>
    </div>
  )
}

export default function Pricing() {
  const { skuId }    = useParams()
  const navigate     = useNavigate()
  const [skus, setSkus]           = useState([])
  const [platforms, setPlatforms] = useState([])
  const [rows, setRows]           = useState([])
  const [selectedSku, setSelectedSku] = useState(skuId ? parseInt(skuId) : '')
  const [loading, setLoading]     = useState(false)
  const [modal, setModal]         = useState(null)
  const [form, setForm]           = useState(EMPTY)
  const [editId, setEditId]       = useState(null)
  const [saving, setSaving]       = useState(false)
  const [toast, setToast]         = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  const showToast = (msg, type = 'success') => setToast({ msg, type })

  useEffect(() => {
    Promise.all([getSkus(), getPlatforms()])
      .then(([s, p]) => { setSkus(s); setPlatforms(p) })
  }, [])

  const loadPricing = (id) => {
    if (!id) { setRows([]); return }
    setLoading(true)
    getPricingForSku(id).then(setRows).finally(() => setLoading(false))
  }

  useEffect(() => { loadPricing(selectedSku) }, [selectedSku])

  const handleSkuChange = (id) => {
    setSelectedSku(id ? parseInt(id) : '')
    navigate(id ? `/pricing/${id}` : '/pricing')
  }

  const openCreate = () => { setForm(EMPTY); setEditId(null); setModal('create') }
  const openEdit = (row) => {
    setForm({
      platform_id: row.platform_id, price: row.price,
      package: row.package, logistics: row.logistics,
      addons: row.addons, cr_percentage: row.cr_percentage,
      cr_cost: row.cr_cost, damage_percentage: row.damage_percentage,
      damage_cost: row.damage_cost, misc_total: row.misc_total, gst: row.gst,
    })
    setEditId(row.id)
    setModal('edit')
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = {
        sku_id:            parseInt(selectedSku),
        platform_id:       parseInt(form.platform_id),
        price:             parseFloat(form.price),
        package:           parseFloat(form.package),
        logistics:         parseFloat(form.logistics),
        addons:            parseFloat(form.addons) || 0,
        cr_percentage:     parseFloat(form.cr_percentage),
        damage_percentage: parseFloat(form.damage_percentage),
        gst:               parseFloat(form.gst) || 0,
        ...(form.cr_cost     !== '' && { cr_cost:     parseFloat(form.cr_cost) }),
        ...(form.damage_cost !== '' && { damage_cost: parseFloat(form.damage_cost) }),
        ...(form.misc_total  !== '' && { misc_total:  parseFloat(form.misc_total) }),
      }
      if (modal === 'create') {
        await createPricing(payload)
        showToast('Pricing created — auto-calculated!')
      } else {
        await updatePricing(editId, payload)
        showToast('Pricing updated & recalculated!')
      }
      setModal(null)
      loadPricing(selectedSku)
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error saving', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (row) => {
    try {
      await deletePricing(row.id)
      showToast('Pricing removed')
      setDeleteConfirm(null)
      loadPricing(selectedSku)
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error deleting', 'error')
    }
  }

  const currentSku      = skus.find(s => s.id === parseInt(selectedSku))
  const pricedPlatforms = new Set(rows.map(r => r.platform_id))

  return (
    <div className="pricing-page">
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title">Pricing</h1>
          <p className="page-subtitle">Auto-calculates breakeven, profit & bank settlement</p>
        </div>
        {selectedSku && (
          <button className="btn btn-gold" onClick={openCreate}>+ Add Platform</button>
        )}
      </div>

      {/* SKU Selector */}
      <div className="card sku-selector">
        <div style={{ display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
          <label style={{ fontSize:12, fontWeight:700, color:'var(--text-2)', letterSpacing:'0.05em', textTransform:'uppercase', whiteSpace:'nowrap' }}>
            Select SKU
          </label>
          <select className="input" style={{ maxWidth:420 }}
            value={selectedSku} onChange={e => handleSkuChange(e.target.value)}>
            <option value="">— Choose a SKU —</option>
            {skus.filter(s => s.is_active).map(s => (
              <option key={s.id} value={s.id}>
                {s.shringar_sku}{s.description ? ` — ${s.description}` : ''}
              </option>
            ))}
          </select>
          {currentSku && (
            <span className="mono" style={{ color:'var(--gold)', fontSize:13 }}>
              {currentSku.vendor?.name && `· ${currentSku.vendor.name}`}
            </span>
          )}
        </div>
      </div>

      {/* Pricing cards or empty state */}
      {selectedSku && (
        loading ? (
          <div className="loader-page"><div className="loader" style={{ width:32, height:32 }} /></div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">◆</div>
            <div className="empty-title">No pricing yet</div>
            <p className="empty-sub">Add a platform to calculate breakeven and bank settlement</p>
            <button className="btn btn-gold" onClick={openCreate} style={{ marginTop:16 }}>
              + Add Platform Pricing
            </button>
          </div>
        ) : (
          <div className="pricing-grid">
            {rows.map(row => (
              <PricingCard key={row.id} row={row}
                platform={platforms.find(p => p.id === row.platform_id)}
                onEdit={openEdit} onDelete={setDeleteConfirm} />
            ))}
          </div>
        )
      )}

      {/* Formula reference (shown when no SKU selected) */}
      {!selectedSku && (
        <div className="card formula-card">
          <div className="formula-title">Pricing Formula Reference</div>
          {[
            ['CR Cost',         'platform.cr_charge × (cr_percentage / 100)'],
            ['Damage Cost',     'price × (damage_percentage / 100)'],
            ['Breakeven',       'price + package + logistics + addons + misc + cr_cost + damage_cost'],
            ['Net Profit',      'breakeven × (profit_percentage / 100)'],
            ['BS w/o GST',      'round(breakeven + net_profit)'],
            ['Bank Settlement', 'bs_wo_gst + round(bs_wo_gst × gst_rate / 100)'],
          ].map(([name, formula]) => (
            <div key={name} className="formula-row">
              <span className="formula-name">{name}</span>
              <span className="formula-eq mono">{formula}</span>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      {modal && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal" style={{ maxWidth:560 }}>
            <div className="modal-title">
              {modal === 'create' ? 'Add Platform Pricing' : 'Edit Pricing'}
            </div>

            {currentSku && (
              <div style={{ marginBottom:18, padding:'8px 12px', background:'var(--surface-2)', borderRadius:'var(--radius-sm)', fontSize:13 }}>
                <span style={{ color:'var(--text-3)' }}>SKU: </span>
                <span className="mono" style={{ color:'var(--gold)' }}>{currentSku.shringar_sku}</span>
              </div>
            )}

            <div className="form-grid">
              <div className="input-group span-2">
                <label>Platform *</label>
                <select className="input" value={form.platform_id}
                  onChange={e => setForm(f => ({ ...f, platform_id: e.target.value }))}>
                  <option value="">— Select Platform —</option>
                  {platforms.filter(p => p.is_active).map(p => (
                    <option key={p.id} value={p.id}
                      disabled={modal === 'create' && pricedPlatforms.has(p.id)}>
                      {p.name} — CR ₹{p.cr_charge}
                      {modal === 'create' && pricedPlatforms.has(p.id) ? ' (already priced)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="input-group">
                <label>Price (₹) *</label>
                <input className="input mono" type="number" placeholder="64"
                  value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
              </div>
              <div className="input-group">
                <label>Packaging (₹) *</label>
                <input className="input mono" type="number" placeholder="7"
                  value={form.package} onChange={e => setForm(f => ({ ...f, package: e.target.value }))} />
              </div>
              <div className="input-group">
                <label>Logistics (₹) *</label>
                <input className="input mono" type="number" placeholder="5"
                  value={form.logistics} onChange={e => setForm(f => ({ ...f, logistics: e.target.value }))} />
              </div>
              <div className="input-group">
                <label>Addons (₹)</label>
                <input className="input mono" type="number" placeholder="0"
                  value={form.addons} onChange={e => setForm(f => ({ ...f, addons: e.target.value }))} />
              </div>

              <div className="input-group">
                <label>CR % (return rate)</label>
                <input className="input mono" type="number" placeholder="10"
                  value={form.cr_percentage} onChange={e => setForm(f => ({ ...f, cr_percentage: e.target.value }))} />
              </div>
              <div className="input-group">
                <label>CR Cost override (₹)</label>
                <input className="input mono" type="number" placeholder="Auto"
                  value={form.cr_cost} onChange={e => setForm(f => ({ ...f, cr_cost: e.target.value }))} />
                <span style={{ fontSize:11, color:'var(--text-3)' }}>Leave blank = auto</span>
              </div>

              <div className="input-group">
                <label>Damage %</label>
                <input className="input mono" type="number" placeholder="15"
                  value={form.damage_percentage} onChange={e => setForm(f => ({ ...f, damage_percentage: e.target.value }))} />
              </div>
              <div className="input-group">
                <label>Damage Cost override (₹)</label>
                <input className="input mono" type="number" placeholder="Auto"
                  value={form.damage_cost} onChange={e => setForm(f => ({ ...f, damage_cost: e.target.value }))} />
                <span style={{ fontSize:11, color:'var(--text-3)' }}>Leave blank = auto</span>
              </div>

              <div className="input-group">
                <label>Misc override (₹)</label>
                <input className="input mono" type="number" placeholder="Auto from settings"
                  value={form.misc_total} onChange={e => setForm(f => ({ ...f, misc_total: e.target.value }))} />
                <span style={{ fontSize:11, color:'var(--text-3)' }}>Leave blank = auto</span>
              </div>
              <div className="input-group">
                <label>GST (₹)</label>
                <input className="input mono" type="number" placeholder="0"
                  value={form.gst} onChange={e => setForm(f => ({ ...f, gst: e.target.value }))} />
              </div>
            </div>

            <div style={{ marginTop:16, padding:'10px 14px', background:'var(--gold-glow)', border:'1px solid var(--gold-dim)', borderRadius:'var(--radius-sm)', fontSize:12, color:'var(--gold)' }}>
              ✦ Breakeven, Net Profit & Bank Settlement are auto-calculated by the server
            </div>

            <div className="form-actions">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-gold" onClick={handleSave}
                disabled={saving || !form.platform_id || !form.price || !form.package || !form.logistics}>
                {saving && <span className="loader" style={{ width:14, height:14, borderWidth:2 }} />}
                {modal === 'create' ? 'Calculate & Save' : 'Update & Recalculate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setDeleteConfirm(null)}>
          <div className="modal" style={{ maxWidth:380 }}>
            <div className="modal-title" style={{ color:'var(--red)' }}>Remove Pricing?</div>
            <p style={{ color:'var(--text-2)', fontSize:14, marginBottom:20 }}>
              Remove <strong style={{ color:'var(--text)' }}>
                {platforms.find(p => p.id === deleteConfirm.platform_id)?.name}
              </strong> pricing from this SKU?
            </p>
            <div className="form-actions">
              <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm)}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}