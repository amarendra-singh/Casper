import { useState, useEffect, useId } from 'react'

import { useParams, useNavigate } from 'react-router-dom'

import { getSkus, getPlatforms, getPricingForSku, createPricing, updatePricing, deletePricing, inCompany, errText } from '../api/client'

import { useCompany } from '../context/CompanyContext'

import ConfirmDialog from '../components/ConfirmDialog'

import './Pricing.css'



function Toast({ msg, type, onClose }) {

  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t) }, [onClose])

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

        <span className={`badge ${platform?.is_active ? 'badge-green' : 'badge-red'}`}>

          {platform?.is_active ? 'Active' : 'Inactive'}

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

          ['GST',       `${row.gst}%`],

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
  const fieldId0 = useId()

  const { skuId }    = useParams()

  const navigate     = useNavigate()

  // A SKU already belongs to one company, so once it's picked, creating pricing

  // for it can target that company directly — no separate picker needed, unlike

  // ledger/billing where a blank record has nothing to infer a company from.

  const { companies, isAll } = useCompany()

  const companyName = id => companies.find(c => c.id === id)?.name

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

      .then(([s, p]) => { setSkus(s); setPlatforms(p) }).catch(e => showToast(errText(e, 'Could not load pricing options'), 'error'))

  }, [])



  const loadPricing = (id) => {

    if (!id) { setRows([]); return }

    setLoading(true)

    return getPricingForSku(id).then(setRows).catch(e => showToast(errText(e, 'Could not load pricing'), 'error')).finally(() => setLoading(false))

  }



  useEffect(() => {

    let current = true

    setRows([])

    if (!selectedSku) {return}

    setLoading(true)

    getPricingForSku(selectedSku)

      .then(data => { if (current) {setRows(data)} })

      .catch(e => { if (current) {showToast(errText(e, 'Could not load pricing'), 'error')} })

      .finally(() => { if (current) {setLoading(false)} })

    return () => { current = false }

  }, [selectedSku])



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

      cr_cost: row.cr_cost_override ?? '', damage_percentage: row.damage_percentage,

      damage_cost: row.damage_cost_override ?? '', misc_total: row.misc_total_override ?? '', gst: row.gst,

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

        cr_cost: form.cr_cost === '' ? null : parseFloat(form.cr_cost),

        damage_cost: form.damage_cost === '' ? null : parseFloat(form.damage_cost),

        misc_total: form.misc_total === '' ? null : parseFloat(form.misc_total),

      }

      if (modal === 'create') {

        // In All Companies the request header is 'all', which the backend refuses

        // for writes — override it with the company the selected SKU already belongs to.

        await createPricing(payload, isAll ? inCompany(currentSku.company_id) : undefined)

        showToast('Pricing created — auto-calculated!')

      } else {

        await updatePricing(editId, payload)

        showToast('Pricing updated & recalculated!')

      }

      setModal(null)

      loadPricing(selectedSku)

    } catch (err) {

      showToast(errText(err, 'Error saving'), 'error')

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

      showToast(errText(err, 'Error deleting'), 'error')

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

          <label htmlFor={fieldId0 + '-field-391'} style={{ fontSize:12, fontWeight:700, color:'var(--text-2)', letterSpacing:'0.05em', textTransform:'uppercase', whiteSpace:'nowrap' }}>

            Select SKU

          </label>

          <select id={fieldId0 + '-field-391'} className="input" style={{ maxWidth:420 }} aria-label="Select SKU"

            value={selectedSku} onChange={e => handleSkuChange(e.target.value)}>

            <option value="">— Choose a SKU —</option>

            {skus.filter(s => s.is_active).map(s => (

              <option key={s.id} value={s.id}>

                {s.shringar_sku}{s.description ? ` — ${s.description}` : ''}

                {/* In All Companies the same SKU code can exist in more than one

                    company — name which one this row is, so picking is unambiguous. */}

                {isAll && companyName(s.company_id) ? ` (${companyName(s.company_id)})` : ''}

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

      <ConfirmDialog open={!!modal} title={modal === 'create' ? 'Add Platform Pricing' : 'Edit Pricing'}

        dialogRole="dialog" className="pricing-dialog"

        confirmLabel={saving ? 'Saving…' : modal === 'create' ? 'Calculate & Save' : 'Update & Recalculate'}

        confirmDisabled={saving || !form.platform_id || form.price === '' || form.package === '' || form.logistics === ''}

        onCancel={() => !saving && setModal(null)} onConfirm={handleSave}>

            {currentSku && (

              <div style={{ marginBottom:18, padding:'8px 12px', background:'var(--surface-2)', borderRadius:'var(--radius-sm)', fontSize:13 }}>

                <span style={{ color:'var(--text-3)' }}>SKU: </span>

                <span className="mono" style={{ color:'var(--gold)' }}>{currentSku.shringar_sku}</span>

              </div>

            )}



            <div className="form-grid">

              <div className="input-group span-2">

                <label htmlFor={fieldId0 + '-field-555'}>Platform *</label>

                <select id={fieldId0 + '-field-555'} className="input" value={form.platform_id} aria-label="Platform"

                  onChange={e => setForm(f => ({ ...f, platform_id: e.target.value }))}>

                  <option value="">— Select Platform —</option>

                  {platforms.filter(p => p.is_active && (!currentSku || p.company_id === currentSku.company_id)).map(p => (

                    <option key={p.id} value={p.id}

                      disabled={modal === 'create' && pricedPlatforms.has(p.id)}>

                      {p.name} — CR ₹{p.cr_charge}

                      {modal === 'create' && pricedPlatforms.has(p.id) ? ' (already priced)' : ''}

                    </option>

                  ))}

                </select>

              </div>



              <div className="input-group">

                <label htmlFor={fieldId0 + '-field-585'}>Price (₹) *</label>

                <input id={fieldId0 + '-field-585'} className="input mono" type="number" placeholder="64" aria-label="Price (₹)"

                  value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />

              </div>

              <div className="input-group">

                <label htmlFor={fieldId0 + '-field-595'}>Packaging (₹) *</label>

                <input id={fieldId0 + '-field-595'} className="input mono" type="number" placeholder="7" aria-label="Packaging (₹)"

                  value={form.package} onChange={e => setForm(f => ({ ...f, package: e.target.value }))} />

              </div>

              <div className="input-group">

                <label htmlFor={fieldId0 + '-field-605'}>Logistics (₹) *</label>

                <input id={fieldId0 + '-field-605'} className="input mono" type="number" placeholder="5" aria-label="Logistics (₹)"

                  value={form.logistics} onChange={e => setForm(f => ({ ...f, logistics: e.target.value }))} />

              </div>

              <div className="input-group">

                <label htmlFor={fieldId0 + '-field-615'}>Addons (₹)</label>

                <input id={fieldId0 + '-field-615'} className="input mono" type="number" placeholder="0" aria-label="Addons (₹)"

                  value={form.addons} onChange={e => setForm(f => ({ ...f, addons: e.target.value }))} />

              </div>



              <div className="input-group">

                <label htmlFor={fieldId0 + '-field-627'}>CR % (return rate)</label>

                <input id={fieldId0 + '-field-627'} className="input mono" type="number" placeholder="10" aria-label="CR % (return rate)"

                  value={form.cr_percentage} onChange={e => setForm(f => ({ ...f, cr_percentage: e.target.value }))} />

              </div>

              <div className="input-group">

                <label htmlFor={fieldId0 + '-field-637'}>CR Cost override (₹)</label>

                <input id={fieldId0 + '-field-637'} className="input mono" type="number" placeholder="Auto" aria-label="CR Cost override (₹)"

                  value={form.cr_cost} onChange={e => setForm(f => ({ ...f, cr_cost: e.target.value }))} />

                <span style={{ fontSize:11, color:'var(--text-3)' }}>Leave blank = auto</span>

              </div>



              <div className="input-group">

                <label htmlFor={fieldId0 + '-field-651'}>Damage %</label>

                <input id={fieldId0 + '-field-651'} className="input mono" type="number" placeholder="15" aria-label="Damage %"

                  value={form.damage_percentage} onChange={e => setForm(f => ({ ...f, damage_percentage: e.target.value }))} />

              </div>

              <div className="input-group">

                <label htmlFor={fieldId0 + '-field-661'}>Damage Cost override (₹)</label>

                <input id={fieldId0 + '-field-661'} className="input mono" type="number" placeholder="Auto" aria-label="Damage Cost override (₹)"

                  value={form.damage_cost} onChange={e => setForm(f => ({ ...f, damage_cost: e.target.value }))} />

                <span style={{ fontSize:11, color:'var(--text-3)' }}>Leave blank = auto</span>

              </div>



              <div className="input-group">

                <label htmlFor={fieldId0 + '-field-675'}>Misc override (₹)</label>

                <input id={fieldId0 + '-field-675'} className="input mono" type="number" placeholder="Auto from settings" aria-label="Misc override (₹)"

                  value={form.misc_total} onChange={e => setForm(f => ({ ...f, misc_total: e.target.value }))} />

                <span style={{ fontSize:11, color:'var(--text-3)' }}>Leave blank = auto</span>

              </div>

              <div className="input-group">

                <label htmlFor={fieldId0 + '-field-687'}>GST (%)</label>

                <input id={fieldId0 + '-field-687'} className="input mono" type="number" placeholder="0" aria-label="GST (%)"

                  value={form.gst} onChange={e => setForm(f => ({ ...f, gst: e.target.value }))} />

              </div>

            </div>



            <div style={{ marginTop:16, padding:'10px 14px', background:'var(--gold-glow)', border:'1px solid var(--gold-dim)', borderRadius:'var(--radius-sm)', fontSize:12, color:'var(--gold)' }}>

              ✦ Breakeven, Net Profit & Bank Settlement are auto-calculated by the server

            </div>



      </ConfirmDialog>



      <ConfirmDialog open={!!deleteConfirm} title="Remove pricing?" tone="danger" confirmLabel="Remove pricing"

        onCancel={() => setDeleteConfirm(null)} onConfirm={() => { handleDelete(deleteConfirm); setDeleteConfirm(null) }}>

        Remove this platform's pricing from the selected SKU?

      </ConfirmDialog>

    </div>

  )

}