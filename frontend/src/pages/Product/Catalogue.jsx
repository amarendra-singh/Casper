import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { createSku, getCatalogue, getPlatforms } from '../../api/client'
import { useCompany } from '../../context/CompanyContext'
import ConfirmDialog from '../../components/ConfirmDialog'
import ProductImage from './ProductImage'
import BulkProductImport from './BulkProductImport'
import './Catalogue.css'

const money = value => value == null ? '—' : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const errorText = (error, fallback = 'Could not load catalogue.') =>
  typeof error.response?.data?.detail === 'string' ? error.response.data.detail : fallback

export function groupPackVariants(items) {
  const groups = new Map()
  for (const product of items) {
    const match = /^(.*)-P([1-9]\d*)$/i.exec(product.our_sku)
    const key = match ? `${product.company_id}:${match[1].toUpperCase()}` : `sku:${product.id}`
    if (!groups.has(key)) { groups.set(key, { key, label: match?.[1] || product.our_sku, items: [] }) }
    groups.get(key).items.push(product)
  }
  return [...groups.values()].map(group => ({ ...group,
    isPackGroup: group.items.length > 1,
    items: [...group.items].sort((a, b) => {
      const aPack = Number(/-P(\d+)$/i.exec(a.our_sku)?.[1] || 0)
      const bPack = Number(/-P(\d+)$/i.exec(b.our_sku)?.[1] || 0)
      return aPack - bPack
    }),
  }))
}

export default function Catalogue() {
  const { activeId, isAll, role } = useCompany()
  const canEdit = !isAll && ['owner', 'admin'].includes(role)
  const navigate = useNavigate()
  const [urlParams, setUrlParams] = useSearchParams()
  const [query, setQuery] = useState(urlParams.get('q') || '')
  const [search, setSearch] = useState(urlParams.get('q') || '')
  const [page, setPage] = useState(1)
  const [active, setActive] = useState('')
  const [platformId, setPlatformId] = useState('')
  const [platforms, setPlatforms] = useState([])
  const [result, setResult] = useState({ items: [], total: 0, page_size: 40 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set())
  const [showAdd, setShowAdd] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [notice, setNotice] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)
  const [addForm, setAddForm] = useState({ shringar_sku: '', display_name: '', vendor_sku: '', description: '',
    reverse_shipping_platform_id: '', reverse_shipping_charge: '' })
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')

  useEffect(() => {
    if (isAll) { setPlatforms([]); setPlatformId(''); return }
    getPlatforms().then(setPlatforms).catch(() => setPlatforms([]))
  }, [activeId, isAll])
  useEffect(() => {
    let live = true
    setLoading(true); setError('')
    getCatalogue({ q: search || undefined, page, platform_id: platformId || undefined,
      active: active === '' ? undefined : active === 'active' })
      .then(data => { if (live) { setResult(data) } })
      .catch(err => { if (live) { setError(errorText(err)) } })
      .finally(() => { if (live) { setLoading(false) } })
    return () => { live = false }
  }, [activeId, search, page, platformId, active, refreshToken])
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = query.trim()
      setPage(1); setSearch(next)
      if (next !== (urlParams.get('q') || '')) { setUrlParams(next ? { q: next } : {}, { replace: true }) }
    }, 250)
    return () => clearTimeout(timer)
  }, [query, urlParams, setUrlParams])

  const lastPage = Math.max(1, Math.ceil(result.total / result.page_size))
  const groups = useMemo(() => groupPackVariants(result.items), [result.items])
  const packGroups = groups.filter(group => group.isPackGroup)
  const allPacksCollapsed = packGroups.length > 0 && packGroups.every(group => collapsedGroups.has(group.key))
  const visibleGroups = groups
  const toggleAllGroups = () => setCollapsedGroups(allPacksCollapsed ? new Set() :
    new Set(packGroups.map(group => group.key)))
  const toggleGroup = key => setCollapsedGroups(current => {
    const next = new Set(current)
    if (next.has(key)) { next.delete(key) } else { next.add(key) }
    return next
  })
  const addProduct = async () => {
    if (!addForm.shringar_sku.trim() || addSaving) { return }
    setAddSaving(true); setAddError('')
    try {
      const charge = addForm.reverse_shipping_charge.trim()
      if (charge !== '' && (!addForm.reverse_shipping_platform_id || !Number.isFinite(Number(charge)) || Number(charge) < 0)) {
        setAddError('Choose a platform and enter a valid nonnegative reverse shipping charge.'); return
      }
      const created = await createSku({
        shringar_sku: addForm.shringar_sku.trim(),
        display_name: addForm.display_name.trim() || null,
        vendor_sku: addForm.vendor_sku.trim() || null,
        description: addForm.description.trim() || null,
        ...(charge !== '' ? { reverse_shipping_platform_id: Number(addForm.reverse_shipping_platform_id),
          reverse_shipping_charge: Number(charge) } : {}),
      })
      setShowAdd(false)
      navigate(`/product/catalogue/${created.id}`)
    } catch (error) { setAddError(errorText(error, 'Could not add product. Please try again.')) }
    finally { setAddSaving(false) }
  }
  return <div className="catalogue-page">
    {showImport && <BulkProductImport onClose={() => setShowImport(false)} onSaved={counts => {
      setShowImport(false)
      setNotice(`${counts.created} created · ${counts.updated} updated · ${counts.deactivated} deactivated. Pricing, cost, stock and images saved where supplied.`)
      setQuery(''); setSearch(''); setActive(''); setPage(1)
      setRefreshToken(value => value + 1)
    }} />}
    <ConfirmDialog open={showAdd} title="Add product" dialogRole="dialog" className="workflow-dialog"
      onCancel={() => !addSaving && setShowAdd(false)} onConfirm={addProduct}
      confirmLabel={addSaving ? 'Adding…' : 'Add product'}
      confirmDisabled={addSaving || !addForm.shringar_sku.trim()}>
      <p>Create the SKU here. You can set a reverse shipping charge now or add one on the product profile after saving.</p>
      <label>Our SKU<input aria-label="Our SKU" maxLength={150} value={addForm.shringar_sku}
        onChange={e => setAddForm(form => ({ ...form, shringar_sku: e.target.value }))} /></label>
      <label>Product name<input aria-label="Product name" maxLength={200} value={addForm.display_name}
        onChange={e => setAddForm(form => ({ ...form, display_name: e.target.value }))} /></label>
      <label>Vendor SKU<input aria-label="Vendor SKU" maxLength={150} value={addForm.vendor_sku}
        onChange={e => setAddForm(form => ({ ...form, vendor_sku: e.target.value }))} /></label>
      <label>Description<textarea aria-label="Description" value={addForm.description}
        onChange={e => setAddForm(form => ({ ...form, description: e.target.value }))} /></label>
      <div className="catalogue-add-shipping">
        <strong>Reverse shipping per return <small>Optional · for one platform</small></strong>
        <div className="catalogue-shipping-fields">
          <label>Platform<select aria-label="Reverse shipping platform" value={addForm.reverse_shipping_platform_id}
            onChange={e => setAddForm(form => ({ ...form, reverse_shipping_platform_id: e.target.value }))}>
            <option value="">Choose platform</option>{platforms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
          <label>Charge / return ₹<input aria-label="Reverse shipping charge per return" type="number" min="0" step="0.01"
            value={addForm.reverse_shipping_charge} placeholder="Uses platform default if blank"
            onChange={e => setAddForm(form => ({ ...form, reverse_shipping_charge: e.target.value }))} /></label>
        </div>
      </div>
      {addError && <p className="catalogue-error" role="alert">{addError}</p>}
    </ConfirmDialog>
    <header className="catalogue-header">
      <div>
        <p className="catalogue-eyebrow">Product workspace</p>
        <h1>Catalogue</h1>
        <p>Sellable SKUs, approved costs, and physical stock in one place.</p>
      </div>
      <div className="catalogue-header-actions">
        <button className="catalogue-group-toggle" aria-pressed={allPacksCollapsed}
          disabled={!packGroups.length} onClick={toggleAllGroups}>
          {allPacksCollapsed ? 'Expand packs' : 'Collapse packs'}
        </button>
        {canEdit && <button onClick={() => setShowImport(true)}>Bulk upload</button>}
        {canEdit && <button className="catalogue-button" onClick={() => setShowAdd(true)}>+ Add product</button>}
      </div>
    </header>
    <div className="catalogue-toolbar">
      <label htmlFor="catalogue-search">Search products
        <input id="catalogue-search" aria-label="Search products" value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Our SKU, vendor SKU, name or marketplace alias" />
      </label>
      {!isAll && <label>Customer return cost for
        <select value={platformId} onChange={e => { setPlatformId(e.target.value); setPage(1) }}>
          <option value="">Choose platform</option>
          {platforms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>}
      <label>Status
        <select value={active} onChange={e => { setActive(e.target.value); setPage(1) }}>
          <option value="">All statuses</option><option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </label>
    </div>
    {error && <p className="catalogue-error" role="alert">{error} <button onClick={() => setRefreshToken(value => value + 1)}>Retry</button></p>}
    {notice && <p className="catalogue-notice" role="status">{notice}</p>}
    <div className="catalogue-table-wrap">
      <table className="catalogue-table">
        <thead><tr><th>Product</th>{isAll && <th>Company</th>}<th>Vendor SKU</th>
          <th>Cost / SKU</th><th>On hand</th><th>Expected customer return</th><th>Status</th></tr></thead>
        <tbody>
          {visibleGroups.flatMap(group => [
            ...(group.isPackGroup ? [<tr key={`group:${group.key}`} className="catalogue-pack-row"><td colSpan={isAll ? 7 : 6}>
              <button className="catalogue-pack-toggle" aria-expanded={!collapsedGroups.has(group.key)}
                onClick={() => toggleGroup(group.key)}>
                <span className="catalogue-pack-chevron" aria-hidden="true">{collapsedGroups.has(group.key) ? '▸' : '▾'}</span>
                <strong>{group.label}</strong><span>{group.items.length} packs</span>
                <small>{group.items.map(p => /-P(\d+)$/i.exec(p.our_sku)?.[0]?.slice(1)).join(' · ')}</small>
              </button>
            </td></tr>] : []),
            ...(group.isPackGroup && collapsedGroups.has(group.key) ? [] : group.items.map(p => <tr key={p.id}>
            <td><Link className="catalogue-product" to={`/product/catalogue/${p.id}`}>
              <ProductImage id={p.primary_image_id} externalUrl={p.primary_image_url} thumb alt={p.name} className="catalogue-thumb" />
              <span><strong>{p.name}</strong><small>{p.our_sku}</small></span>
            </Link></td>
            {isAll && <td>{p.company_name}</td>}
            <td>{p.vendor_sku || '—'}<small>{p.vendor_name || ''}</small></td>
            <td>{money(p.purchase_cost)}<small>{p.pricing_cost_drift ? 'Approved · pricing differs' :
              p.cost_source === 'approved' ? 'Approved' :
              p.cost_source === 'legacy_pricing' ? 'Pricing value · unapproved' :
              p.cost_source === 'conflicting_pricing' ? 'Conflicting pricing' : 'Cost missing'}</small></td>
            <td>{p.on_hand_base_units == null ? (p.stock_item_id ? 'Not counted' : 'Not tracked') :
              `${p.on_hand_base_units} base units · ${p.on_hand_pack_equivalent} packs`}
              <small>{p.stock_item_name ? `${p.stock_item_name} · 1 SKU = ${p.base_units_per_sku} base units` : 'No stock item linked'}</small></td>
            <td>{platformId ? money(p.expected_customer_return_cost) : 'Choose platform'}
              <small>{platformId ? 'Expected allowance / SKU' : ''}</small></td>
            <td><span className={p.is_active ? 'catalogue-status active' : 'catalogue-status'}>
              {p.is_active ? 'Active' : 'Inactive'}</span></td>
          </tr>)),
          ])}
        </tbody>
      </table>
      {!loading && !error && !result.items.length && <div className="catalogue-empty">
        {search ? 'No products match this search.' : 'No products yet. Add your first product here.'}
      </div>}
      {loading && <div className="catalogue-empty" role="status">Loading products…</div>}
    </div>
    <div className="catalogue-cards">
      {visibleGroups.map(group => <Fragment key={group.key}>
        {group.isPackGroup && <button className="catalogue-mobile-group"
          aria-expanded={!collapsedGroups.has(group.key)} onClick={() => toggleGroup(group.key)}>
          <strong>{collapsedGroups.has(group.key) ? '▸' : '▾'} {group.label}</strong>
          <span>{group.items.length} packs · {group.items.map(p => /-P(\d+)$/i.exec(p.our_sku)?.[0]?.slice(1)).join(', ')}</span>
        </button>}
        {(!group.isPackGroup || !collapsedGroups.has(group.key)) && group.items.map(p => <article className="catalogue-mobile-card" key={p.id}>
        <Link className="catalogue-product" to={`/product/catalogue/${p.id}`}>
          <ProductImage id={p.primary_image_id} externalUrl={p.primary_image_url} thumb alt={p.name} className="catalogue-thumb" />
          <span><strong>{p.name}</strong><small>{p.our_sku}</small></span>
        </Link>
        {isAll && <p>{p.company_name}</p>}
        <dl>
          <div><dt>Vendor SKU</dt><dd>{p.vendor_sku || '—'}</dd></div>
          <div><dt>Purchase cost / SKU</dt><dd>{money(p.purchase_cost)}
            <small>{p.pricing_cost_drift ? 'Pricing differs' : p.cost_source.replaceAll('_', ' ')}</small></dd></div>
          <div><dt>On hand</dt><dd>{p.on_hand_base_units == null ?
            (p.stock_item_id ? 'Not counted' : 'Not tracked') :
            `${p.on_hand_base_units} base units · ${p.on_hand_pack_equivalent} packs`}</dd></div>
          <div><dt>Expected return / SKU</dt><dd>{platformId ?
            money(p.expected_customer_return_cost) : 'Choose platform'}</dd></div>
        </dl>
        <Link className="profile-source-link" to={`/product/catalogue/${p.id}`}>Open product profile →</Link>
        </article>)}
      </Fragment>)}
      {!loading && !error && !result.items.length && <p className="catalogue-empty">
        {search ? 'No products match this search.' : 'No products yet. Add a product here.'}</p>}
      {loading && <p className="catalogue-empty" role="status">Loading products…</p>}
    </div>
    <footer className="catalogue-pagination">
      <span>{result.total} products · page {page} of {lastPage}</span>
      <div><button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <button disabled={page >= lastPage} onClick={() => setPage(page + 1)}>Next</button></div>
    </footer>
  </div>
}
