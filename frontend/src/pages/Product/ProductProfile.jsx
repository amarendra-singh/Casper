import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  getCatalogueProduct, updateCatalogueProduct, updateCatalogueReverseShipping, getStockItems, createStockItem,
  linkProductStock, recordStockMovement, reverseStockMovement,
  approveStockCost, previewStockCost, applyStockCost,
  uploadProductImage, setProductPrimaryImage, deleteProductImage,
} from '../../api/client'
import { useCompany } from '../../context/CompanyContext'
import ConfirmDialog from '../../components/ConfirmDialog'
import ProductImage from './ProductImage'
import './Catalogue.css'

const today = () => new Date().toLocaleDateString('en-CA')
const money = n => n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const errorText = e => {
  const detail = e.response?.data?.detail
  return typeof detail === 'string' ? detail : 'The operation could not be completed.'
}

export default function ProductProfile() {
  const { skuId } = useParams()
  const [searchParams] = useSearchParams()
  const { isAll, role } = useCompany()
  const canEdit = !isAll && ['owner', 'admin'].includes(role)
  const [data, setData] = useState(null)
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [working, setWorking] = useState(false)
  const [platformId, setPlatformId] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [name, setName] = useState('')
  const [vendorSku, setVendorSku] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [description, setDescription] = useState('')
  const [gstRate, setGstRate] = useState('')
  const [shippingDraft, setShippingDraft] = useState({})
  const [stockItemId, setStockItemId] = useState('')
  const [packUnits, setPackUnits] = useState(1)
  const [newItemName, setNewItemName] = useState('')
  const [movement, setMovement] = useState({ movement_type: 'receipt', sku_quantity: 1, movement_date: today(), reason: '', inspected_resaleable: false, bill_line_id: '' })
  const [cost, setCost] = useState({ source_type: searchParams.get('billLine') ? 'bill_line' : 'manual', source_id: searchParams.get('billLine') || '', cost_per_base_unit: '', effective_date: today(), note: '' })
  const [preview, setPreview] = useState(null)
  const [confirm, setConfirm] = useState(null)

  const load = useCallback(async () => {
    const product = await getCatalogueProduct(skuId, {
      platform_id: platformId || undefined, start: start || undefined, end: end || undefined,
    })
    setData(product)
    setName(product.name === product.our_sku ? '' : product.name)
    setVendorSku(product.vendor_sku || '')
    setIsActive(product.is_active)
    setDescription(product.description || '')
    setGstRate(product.gst_rate == null ? '' : String(product.gst_rate))
    setShippingDraft(Object.fromEntries((product.reverse_shipping || []).map(row =>
      [row.platform_id, row.override == null ? '' : String(row.override)])))
    setStockItemId(product.stock_item_id || '')
    setPackUnits(product.base_units_per_sku || 1)
    if (!isAll) { setItems(await getStockItems()) }
  }, [skuId, isAll, platformId, start, end])
  useEffect(() => {
    let live = true
    setData(null); setError('')
    load().catch(e => { if (live) { setError(errorText(e)) } })
    return () => { live = false }
  }, [load])
  async function mutate(action, message) {
    setWorking(true); setError(''); setNotice('')
    try {
      await action()
      await load()
      setPreview(null)
      setNotice(message)
    } catch (e) { setError(errorText(e)) }
    finally { setWorking(false); setConfirm(null) }
  }
  if (!data) { return <div className="catalogue-page"><Link to="/product/catalogue">← Catalogue</Link>
    <p role={error ? 'alert' : 'status'}>{error || 'Loading product…'}</p></div> }
  const p = data.performance
  const stock = data.stock_item
  const chosenItem = items.find(i => i.id === Number(stockItemId))
  return <div className="catalogue-page profile-page">
    <Link to="/product/catalogue" className="profile-back">← Catalogue</Link>
    <header className="catalogue-header">
      <div><p className="catalogue-eyebrow">Product profile {data.company_name ? `· ${data.company_name}` : ''}</p>
        <h1>{data.name}</h1><p>{data.our_sku} · Vendor SKU {data.vendor_sku || 'not set'}
          {data.vendor_name ? ` · ${data.vendor_name}` : ''}</p></div>
      {canEdit && <a className="catalogue-button" href="#product-identity">Edit product</a>}
    </header>
    {error && <p className="catalogue-error" role="alert">{error}</p>}
    {notice && <p className="catalogue-notice" role="status">{notice}</p>}
    {isAll && <p className="catalogue-note">All Companies is read-only. Select {data.company_name || 'this company'} to edit this product.</p>}
    <div className="profile-top">
      <section className="catalogue-card profile-gallery">
        <div className="profile-hero"><ProductImage id={data.primary_image_id} externalUrl={data.primary_image_url} alt={data.name} /></div>
        <div className="profile-thumbnails">
          {data.images.map(img => <div key={img.id} className="profile-image-option">
            <ProductImage id={img.id} thumb alt={img.alt_text || data.name} />
            {img.is_primary ? <small>Primary</small> : canEdit && <button disabled={working}
              onClick={() => mutate(() => setProductPrimaryImage(img.id), 'Primary image changed.')}>Set primary</button>}
            {canEdit && <button disabled={working} onClick={() => setConfirm({
              title: 'Delete product image?', label: 'Delete image', tone: 'danger',
              action: () => mutate(() => deleteProductImage(img.id), 'Image deleted.'),
            })}>Delete</button>}
          </div>)}
        </div>
        {canEdit && <label htmlFor="profile-image" className="catalogue-file">Add product image (JPEG, PNG or WebP, up to 5 MB)
          <input id="profile-image" aria-label="Add product image" type="file" accept="image/jpeg,image/png,image/webp" disabled={working}
            onChange={e => {
              const file = e.target.files?.[0]
              if (!file) { return }
              const body = new FormData(); body.append('file', file)
              body.append('alt_text', data.name)
              mutate(() => uploadProductImage(skuId, body), 'Image uploaded.')
              e.target.value = ''
            }} />
        </label>}
      </section>
      <section className="catalogue-card" id="product-identity">
        <h2>Identity</h2>
        <dl className="profile-facts">
          <div><dt>Our SKU</dt><dd>{data.our_sku}</dd></div>
          <div><dt>Vendor SKU</dt><dd>{data.vendor_sku || '—'}</dd></div>
          <div><dt>Category</dt><dd>{data.category_name || '—'}</dd></div>
          <div><dt>HSN</dt><dd>{data.hsn_code || '—'}</dd></div>
          <div><dt>GST</dt><dd>{data.gst_rate == null ? 'Not set' : `${data.gst_rate}%`}</dd></div>
          <div><dt>Status</dt><dd>{data.is_active ? 'Active' : 'Inactive'}</dd></div>
        </dl>
        {canEdit ? <form className="profile-form" onSubmit={e => {
          e.preventDefault()
          mutate(() => updateCatalogueProduct(skuId, {
            display_name: name, vendor_sku: vendorSku, description, is_active: isActive,
            gst_rate: gstRate === '' ? null : Number(gstRate),
          }), 'Product details saved.')
        }}>
          <label htmlFor="profile-name">Display name<input id="profile-name" aria-label="Display name" value={name} maxLength={200} onChange={e => setName(e.target.value)}
            placeholder="Customer-friendly product name" /></label>
          <label htmlFor="profile-vendor-sku">Vendor SKU<input id="profile-vendor-sku" aria-label="Vendor SKU" value={vendorSku}
            maxLength={150} onChange={e => setVendorSku(e.target.value)} /></label>
          <label htmlFor="profile-description">Description<textarea id="profile-description" aria-label="Description" value={description} onChange={e => setDescription(e.target.value)}
            rows={3} /></label>
          <label htmlFor="profile-gst">GST rate %<input id="profile-gst" aria-label="Catalogue GST rate" type="number"
            min="0" max="100" step="0.01" value={gstRate} onChange={e => setGstRate(e.target.value)}
            placeholder="Set verified rate" /></label>
          <label htmlFor="profile-status">Status<select id="profile-status" aria-label="Status" value={isActive ? 'active' : 'inactive'}
            onChange={e => setIsActive(e.target.value === 'active')}>
            <option value="active">Active</option><option value="inactive">Inactive</option>
          </select></label>
          <button className="catalogue-button" disabled={working}>Save details</button>
        </form> : <p>{data.description || 'No description'}</p>}
      </section>
    </div>
    <section className="catalogue-card catalogue-shipping-card" aria-label="SKU reverse shipping">
      <div className="catalogue-shipping-heading"><div><h2>Reverse shipping by platform</h2>
        <p className="catalogue-note">Charge for one returned SKU. Leave blank to use the platform amount; enter 0 for no charge.</p></div></div>
      <div className="catalogue-shipping-list">{(data.reverse_shipping || []).map(row =>
        <form key={row.platform_id} className="catalogue-shipping-row" onSubmit={e => {
          e.preventDefault()
          const raw = (shippingDraft[row.platform_id] ?? '').trim()
          const charge = raw === '' ? null : Number(raw)
          if (charge !== null && (!Number.isFinite(charge) || charge < 0)) {
            setError('Enter a valid nonnegative reverse shipping charge.'); return
          }
          mutate(() => updateCatalogueReverseShipping(skuId, { platform_id: row.platform_id, charge }),
            `${row.platform_name} reverse shipping saved.`)
        }}>
          <div className="catalogue-shipping-platform"><strong>{row.platform_name}</strong>
            <small>Platform amount {money(row.platform_charge)} / return</small></div>
          <label>SKU charge / return ₹<input aria-label={`${row.platform_name} SKU reverse shipping charge per return`}
            type="number" min="0" step="0.01" value={shippingDraft[row.platform_id] ?? ''}
            placeholder={`Inherit ${money(row.platform_charge)}`}
            disabled={!canEdit || working}
            onChange={e => setShippingDraft(current => ({ ...current, [row.platform_id]: e.target.value }))} /></label>
          <span className="catalogue-shipping-effective">{row.override == null ? 'Platform default' : 'SKU override'}<br />
            <strong>{money(row.override ?? row.platform_charge)}</strong></span>
          {canEdit && <button className="catalogue-button" disabled={working ||
            (shippingDraft[row.platform_id] ?? '') === (row.override == null ? '' : String(row.override))}>Save</button>}
        </form>)}</div>
      {!data.reverse_shipping?.length && <p className="catalogue-note">Add a platform in Settings to set reverse shipping for this SKU.</p>}
    </section>
    <div className="profile-grid">
      <section className="catalogue-card">
        <h2>Cost and expected returns</h2>
        <dl className="profile-facts">
          <div><dt>Purchase cost / SKU</dt><dd>{money(data.purchase_cost)}</dd></div>
          <div><dt>Cost source</dt><dd>{data.cost_source.replaceAll('_', ' ')}</dd></div>
          <div><dt>Expected customer-return cost / SKU</dt><dd>{platformId ? money(data.expected_customer_return_cost) : 'Select a platform below'}</dd></div>
        </dl>
        {data.cost_source !== 'approved' && <p className="catalogue-note">Pricing cost is unapproved or missing. Approve a physical-item cost below, then review its pricing impact.</p>}
        {data.pricing_cost_drift && <p className="catalogue-error">Current platform pricing differs from the approved product cost. Preview and apply the approved cost below after review.</p>}
        <h3>Platform pricing</h3>
        <p className="catalogue-note">SKU overrides are edited above. Pricing uses the platform amount when no SKU charge is set.</p>
        <div className="profile-scroll"><table className="catalogue-table compact"><thead><tr>
          <th>Platform</th><th>Cost / SKU</th><th>Reverse shipping / return</th><th>Expected return / SKU</th><th>Breakeven</th><th>Settlement</th>
        </tr></thead><tbody>{data.pricing.map(row => <tr key={row.id}>
          <td>{row.platform_name}</td><td>{money(row.price)}</td>
          <td>{money(row.reverse_shipping_charge)}{row.reverse_shipping_overridden ? ' · SKU override' : ' · platform'}</td>
          <td>{money(row.cr_cost)}</td>
          <td>{money(row.breakeven)}</td><td>{money(row.bank_settlement)}</td>
        </tr>)}</tbody></table></div>
      </section>
      <section className="catalogue-card">
        <h2>Shared physical stock</h2>
        <p className="catalogue-note">Supplier bills and marketplace uploads provide evidence; they never change physical stock automatically. Record receipts, dispatches and inspected returns here.</p>
        <dl className="profile-facts">
          <div><dt>Stock item</dt><dd>{stock?.name || 'Not linked'}</dd></div>
          <div><dt>Pack conversion</dt><dd>{stock ? `1 SKU = ${data.base_units_per_sku} ${stock.base_unit}(s)` : '—'}</dd></div>
          <div><dt>On hand</dt><dd>{data.on_hand_base_units == null ? 'Not counted' :
            `${data.on_hand_base_units} ${stock.base_unit}(s) · ${data.on_hand_pack_equivalent} whole packs`}</dd></div>
        </dl>
        {canEdit && <form className="profile-form" onSubmit={e => {
          e.preventDefault()
          mutate(() => linkProductStock(skuId, { stock_item_id: Number(stockItemId), base_units_per_sku: Number(packUnits) }), 'Stock conversion saved.')
        }}>
          <label>Physical stock item<select required value={stockItemId} onChange={e => setStockItemId(e.target.value)}>
            <option value="">Choose shared stock item</option>
            {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.base_unit})</option>)}
          </select></label>
          <label htmlFor="profile-pack">Base units in one SKU<input id="profile-pack" aria-label="Base units in one SKU" type="number" min="1" max="100000" required
            value={packUnits} onChange={e => setPackUnits(e.target.value)} /></label>
          <button disabled={working || !chosenItem}>Save stock link</button>
        </form>}
        {canEdit && <form className="profile-form inline" onSubmit={e => {
          e.preventDefault()
          mutate(async () => {
            const item = await createStockItem({ name: newItemName, base_unit: 'piece' })
            await linkProductStock(skuId, { stock_item_id: item.id, base_units_per_sku: Number(packUnits) })
          }, 'Physical stock item created and linked.')
          setNewItemName('')
        }}>
          <label htmlFor="profile-new-item">New stock item<input id="profile-new-item" aria-label="New stock item" value={newItemName} required minLength={2} maxLength={200}
            onChange={e => setNewItemName(e.target.value)} placeholder="e.g. Rotating glass 300 ml" /></label>
          <button disabled={working}>Create and link</button>
        </form>}
        {data.siblings.length > 1 && <><h3>Variants sharing this balance</h3>
          <div className="profile-tags">{data.siblings.map(s => <Link key={s.id}
            to={`/product/catalogue/${s.id}`}>{s.our_sku} · {s.base_units_per_sku} units</Link>)}</div></>}
      </section>
    </div>
    {stock && <div className="profile-grid">
      <section className="catalogue-card">
        <h2>Stock movements</h2>
        {canEdit && <form className="profile-form" onSubmit={e => {
          e.preventDefault()
          const payload = { ...movement, sku_quantity: Number(movement.sku_quantity),
            bill_line_id: movement.bill_line_id ? Number(movement.bill_line_id) : null,
            request_key: crypto.randomUUID() }
          mutate(() => recordStockMovement(skuId, payload), 'Stock movement recorded.')
        }}>
          <div className="profile-form-row">
            <label>Type<select value={movement.movement_type} onChange={e => setMovement({ ...movement, movement_type: e.target.value })}>
              {['opening', 'receipt', 'dispatch', 'return', 'damage', 'adjustment'].map(t =>
                <option key={t} value={t}>{t}</option>)}</select></label>
            <label htmlFor="profile-quantity">SKU quantity<input id="profile-quantity" aria-label="SKU quantity" type="number" required min={movement.movement_type === 'adjustment' ? undefined : 1}
              value={movement.sku_quantity} onChange={e => setMovement({ ...movement, sku_quantity: e.target.value })} /></label>
            <label htmlFor="profile-movement-date">Date<input id="profile-movement-date" aria-label="Movement date" type="date" required value={movement.movement_date}
              onChange={e => setMovement({ ...movement, movement_date: e.target.value })} /></label>
          </div>
          {movement.movement_type === 'return' && <label htmlFor="profile-resaleable" className="profile-check">
            <input id="profile-resaleable" aria-label="Inspected and resaleable" type="checkbox" checked={movement.inspected_resaleable}
              onChange={e => setMovement({ ...movement, inspected_resaleable: e.target.checked })} />
            Inspected and resaleable</label>}
          {movement.movement_type === 'receipt' && <label>Confirmed supplier bill (optional)
            <select value={movement.bill_line_id} onChange={e => setMovement({ ...movement, bill_line_id: e.target.value })}>
              <option value="">No bill link</option>{data.supplier_bills.map(b =>
                <option key={b.line_id} value={b.line_id}>{b.ref_no} · {b.item_name}</option>)}
            </select></label>}
          <label htmlFor="profile-reason">Reason / reference<input id="profile-reason" aria-label="Movement reason or reference" value={movement.reason}
            onChange={e => setMovement({ ...movement, reason: e.target.value })}
            placeholder="Required for adjustments" /></label>
          <button disabled={working}>Record movement</button>
        </form>}
        <div className="profile-scroll"><table className="catalogue-table compact"><thead><tr>
          <th>Date</th><th>Type</th><th>Change</th><th>Reason</th><th></th>
        </tr></thead><tbody>{data.movements.map(m => <tr key={m.id}>
          <td>{m.date}</td><td>{m.type}</td><td>{m.base_units_delta > 0 ? '+' : ''}{m.base_units_delta} base units</td>
          <td>{m.reason || '—'}</td><td>{canEdit && m.type !== 'reversal' && !data.movements.some(x => x.reverses_id === m.id) &&
            <button disabled={working} onClick={() => setConfirm({
              title: 'Reverse stock movement?', label: 'Reverse', tone: 'danger',
              action: () => mutate(() => reverseStockMovement(m.id, {
                movement_date: today(), reason: 'Corrected from product profile',
              }), 'Movement reversed.'),
            })}>Reverse</button>}</td>
        </tr>)}</tbody></table></div>
      </section>
      <section className="catalogue-card">
        <h2 id="approved-cost">Approved cost history</h2>
        <p className="catalogue-note">Cost applies per physical base unit. Review its impact on every linked SKU before updating current pricing. Imported report snapshots stay frozen.</p>
        {canEdit && <form className="profile-form" onSubmit={e => {
          e.preventDefault()
          mutate(() => approveStockCost(stock.id, {
            source_type: cost.source_type,
            source_id: cost.source_type === 'bill_line' ? Number(cost.source_id) : null,
            cost_per_base_unit: cost.source_type === 'manual' ? Number(cost.cost_per_base_unit) : null,
            effective_date: cost.effective_date, note: cost.note || null,
          }), 'Cost approved. Review pricing impact below.')
        }}>
          <label>Cost source<select value={cost.source_type} onChange={e => setCost({ ...cost, source_type: e.target.value })}>
            <option value="manual">Manual approved cost</option>
            <option value="bill_line">Confirmed supplier bill</option></select></label>
          {cost.source_type === 'manual' ? <>
            <label htmlFor="profile-cost">Cost per {stock.base_unit}<input id="profile-cost" aria-label={`Cost per ${stock.base_unit}`} type="number" min="0.0001" step="0.0001" required
              value={cost.cost_per_base_unit} onChange={e => setCost({ ...cost, cost_per_base_unit: e.target.value })} /></label>
            <label htmlFor="profile-cost-note">Source note<input id="profile-cost-note" aria-label="Cost source note" required value={cost.note} onChange={e => setCost({ ...cost, note: e.target.value })}
              placeholder="Why this cost is approved" /></label>
          </> : <label>Confirmed bill line<select required value={cost.source_id}
            onChange={e => setCost({ ...cost, source_id: e.target.value })}>
            <option value="">Choose bill line</option>{data.supplier_bills.map(b => <option key={b.line_id}
              value={b.line_id}>{b.ref_no} · {b.item_name} · {money(b.unit_cost)} / SKU</option>)}
          </select></label>}
          <label htmlFor="profile-effective-date">Effective date<input id="profile-effective-date" aria-label="Cost effective date" type="date" required value={cost.effective_date}
            onChange={e => setCost({ ...cost, effective_date: e.target.value })} /></label>
          <button disabled={working}>Approve cost</button>
        </form>}
        {canEdit && <div className="profile-actions"><button disabled={working} onClick={async () => {
          setError(''); try { setPreview(await previewStockCost(stock.id)) } catch (e) { setError(errorText(e)) }
        }}>Preview pricing impact</button></div>}
        {preview && <div className="catalogue-preview"><p>{preview.updates.length} pricing rows would change.</p>
          {preview.updates.map(u => <div key={u.pricing_id}>{u.our_sku}: {money(u.before)} → {money(u.after)}</div>)}
          {!!preview.updates.length && <button disabled={working} onClick={() => setConfirm({
            title: 'Apply approved cost to current pricing?', label: 'Apply cost',
            action: () => mutate(() => applyStockCost(stock.id, preview.token), 'Current pricing updated.'),
          })}>Apply to current pricing</button>}
        </div>}
        <div className="profile-scroll"><table className="catalogue-table compact"><thead><tr>
          <th>Effective</th><th>Per base unit</th><th>Source</th></tr></thead><tbody>
          {data.cost_history.map(c => <tr key={c.id}><td>{c.effective_date}</td>
            <td>₹{Number(c.cost_per_base_unit).toLocaleString('en-IN', { maximumFractionDigits: 4 })}</td><td>{c.source_type === 'bill_line' ? `Bill line ${c.source_id}` : 'Manual approval'}</td></tr>)}
        </tbody></table></div>
      </section>
    </div>}
    <div className="profile-grid">
      <section className="catalogue-card">
        <h2>Marketplace performance</h2>
        <div className="profile-form-row">
          <label>Platform<select value={platformId} onChange={e => setPlatformId(e.target.value)}>
            <option value="">All platforms</option>{data.pricing.map(r =>
              <option key={r.platform_id} value={r.platform_id}>{r.platform_name}</option>)}
          </select></label>
          <label htmlFor="profile-from">From<input id="profile-from" aria-label="Report period from" type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
          <label htmlFor="profile-to">To<input id="profile-to" aria-label="Report period to" type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
        </div>
        {p.overlapping_periods && <p className="catalogue-error">Some report periods overlap. Aggregates may count activity twice; inspect reports before relying on totals.</p>}
        <p className="catalogue-note">Date filters include whole reports that overlap the chosen range. Profit includes only rows with cost and payout data; sales uploads do not move stock.</p>
        <dl className="profile-facts">
          <div><dt>Gross units</dt><dd>{p.gross_units}</dd></div>
          <div><dt>Net units</dt><dd>{p.net_units}</dd></div>
          <div><dt>Customer returns</dt><dd>{p.customer_returns}</dd></div>
          <div><dt>RTO units</dt><dd>{p.rto_units}</dd></div>
          <div><dt>Observed reverse shipping</dt><dd>{money(p.observed_reverse_shipping)}</dd></div>
          <div><dt>Profit on costed rows</dt><dd>{money(p.profit)}</dd></div>
          <div><dt>Return on cost</dt><dd>{p.return_on_cost_pct == null ? '—' : `${p.return_on_cost_pct}%`}</dd></div>
          <div><dt>Coverage</dt><dd>{p.profit_rows} profit rows / {p.identity_linked_rows} linked rows
            {p.estimated_cost_rows ? ` · ${p.estimated_cost_rows} current-cost estimates` : ''}</dd></div>
        </dl>
      </section>
      <section className="catalogue-card">
        <h2>Connected records</h2>
        <h3>Confirmed supplier bill lines</h3>
        {data.supplier_bills.length ? <div className="profile-scroll"><table className="catalogue-table compact"><thead>
          <tr><th>Date / ref</th><th>Item</th><th>Rate</th><th>Pack</th><th>Cost / SKU</th></tr>
        </thead><tbody>{data.supplier_bills.map(b => <tr key={b.line_id}>
          <td>{b.date}<small>{b.ref_no}</small></td><td>{b.item_name}</td>
          <td>{money(b.bill_rate)}</td><td>{b.pack_multiple}</td><td>{money(b.unit_cost)}</td>
        </tr>)}</tbody></table></div> : <p className="catalogue-note">No confirmed bill lines linked yet.</p>}
        <p><Link className="profile-source-link" to="/billing">Open supplier bills and invoices →</Link></p>
        <h3>Marketplace identities</h3>
        <div className="profile-tags">{data.aliases.map((a, i) =>
          <span key={i}>{a.platform_name}: {a.name}</span>)}</div>
        {!data.aliases.length && <p className="catalogue-note">No confirmed marketplace aliases.</p>}
        <h3>Report rows</h3>
        {p.report_rows.length ? <div className="profile-scroll"><table className="catalogue-table compact"><thead><tr>
          <th>Period</th><th>Platform SKU</th><th>Net</th><th>Returns</th><th>Profit</th>
        </tr></thead><tbody>{p.report_rows.map((r, i) => <tr key={i}>
          <td><Link className="profile-source-link" to={`/pnl/${encodeURIComponent((r.platform_name || '').toLowerCase())}/${r.report_id}`}>
            {r.period_start} – {r.period_end}</Link></td><td>{r.name}</td><td>{r.net_units}</td>
          <td>{r.customer_returns}</td><td>{money(r.profit)}</td></tr>)}</tbody></table></div> :
          <p className="catalogue-note">No report rows reliably linked to this SKU.</p>}
        {p.report_rows_total > p.report_rows.length && <p className="catalogue-note">Showing first {p.report_rows.length} of {p.report_rows_total} report rows.</p>}
      </section>
    </div>
    <ConfirmDialog open={!!confirm} title={confirm?.title} confirmLabel={confirm?.label}
      tone={confirm?.tone} confirmDisabled={working} onCancel={() => setConfirm(null)}
      onConfirm={() => confirm?.action()}>{confirm?.title}</ConfirmDialog>
  </div>
}
