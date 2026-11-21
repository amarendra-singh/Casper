import { useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { applyCatalogueSheet } from '../../api/client'

const COLUMNS = [
  ['Operation', 'operation'], ['SKU Code', 'shringar_sku'],
  ['Product Name', 'display_name'], ['Vendor SKU', 'vendor_sku'],
  ['Vendor', 'vendor'], ['Category', 'category'], ['HSN Code', 'hsn_code'], ['Series', 'series'],
  ['Description', 'description'], ['Status', 'is_active'],
  ['Stock Item', 'stock_item'], ['Units per SKU', 'base_units_per_sku'],
  ['On Hand Base Units', 'on_hand_base_units'], ['Stock Date', 'stock_date'],
  ['Stock Reason', 'stock_reason'], ['Cost per Base Unit', 'cost_per_base_unit'],
  ['Cost Date', 'cost_effective_date'], ['Cost Note', 'cost_note'],
  ['Platform', 'platform'], ['Price / SKU', 'price'], ['Package', 'package'],
  ['Logistics', 'logistics'], ['Addons', 'addons'], ['GST', 'gst'],
  ['Profit %', 'profit_percentage'], ['Misc Total', 'misc_total'],
  ['CR %', 'cr_percentage'], ['CR Cost', 'cr_cost'],
  ['Reverse Shipping / Return', 'reverse_shipping_charge'],
  ['Damage %', 'damage_percentage'], ['Damage Cost', 'damage_cost'],
  ['Image URL', 'image_url'], ['Image File', 'image_file'],
]
const HEADERS = COLUMNS.map(([label]) => label)
const normalize = value => String(value).toLowerCase().replace(/[^a-z0-9]/g, '')
const aliases = Object.fromEntries(COLUMNS.map(([label, field]) => [normalize(label), field]))
Object.assign(aliases, { sku: 'shringar_sku', oursku: 'shringar_sku',
  productcost: 'price', productprice: 'price', costperunit: 'cost_per_base_unit' })
const NUMBERS = new Set(['base_units_per_sku', 'on_hand_base_units', 'cost_per_base_unit',
  'price', 'package', 'logistics', 'addons', 'gst', 'profit_percentage', 'misc_total',
  'cr_percentage', 'cr_cost', 'reverse_shipping_charge', 'damage_percentage', 'damage_cost'])
const DATES = new Set(['stock_date', 'cost_effective_date'])

export function parseProductSheet(cells) {
  const [header = [], ...body] = cells
  const fields = header.map(value => aliases[normalize(value)] || null)
  if (!fields.includes('operation') || !fields.includes('shringar_sku')) {
    throw new Error('The file needs Operation and SKU Code columns.')
  }
  if (new Set(fields.filter(Boolean)).size !== fields.filter(Boolean).length) {
    throw new Error('The file has duplicate product columns.')
  }
  const rows = []
  for (const [index, cells] of body.entries()) {
    if (!cells.some(value => String(value ?? '').trim())) { continue }
    const ignored = cells.findIndex((value, i) => !fields[i] && String(value ?? '').trim())
    if (ignored >= 0) { throw new Error(`Row ${index + 2}: unsupported column '${header[ignored] || ignored + 1}' has data.`) }
    const row = {}
    fields.forEach((field, i) => {
      if (!field) { return }
      const value = cells[i]
      if (value == null || String(value).trim() === '') { return }
      if (NUMBERS.has(field)) {
        const number = Number(value)
        if (!Number.isFinite(number) || number < 0 || (field === 'gst' && number > 100) ||
            (['base_units_per_sku', 'on_hand_base_units'].includes(field) && !Number.isInteger(number))) {
          throw new Error(`Row ${index + 2}: ${header[i]} must be a nonnegative number.`)
        }
        row[field] = number
      } else if (DATES.has(field)) {
        const date = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim()
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
          throw new Error(`Row ${index + 2}: ${header[i]} must be YYYY-MM-DD.`)
        }
        row[field] = date
      } else if (field === 'is_active') {
        const status = String(value).trim().toLowerCase()
        if (!['active', 'inactive', 'true', 'false', '1', '0'].includes(status)) {
          throw new Error(`Row ${index + 2}: Status must be Active or Inactive.`)
        }
        row[field] = ['active', 'true', '1'].includes(status)
      } else { row[field] = String(value).trim() }
    })
    row.operation = String(row.operation || '').toLowerCase()
    if (!['create', 'update', 'delete'].includes(row.operation)) {
      throw new Error(`Row ${index + 2}: Operation must be create, update or delete.`)
    }
    if (!row.shringar_sku) { throw new Error(`Row ${index + 2}: SKU Code is required.`) }
    row.shringar_sku = row.shringar_sku.toUpperCase()
    if (row.image_url && row.image_url.toLowerCase() !== '<clear>' && !/^https:\/\/[^\s/]+/i.test(row.image_url)) {
      throw new Error(`Row ${index + 2}: Image URL must use HTTPS.`)
    }
    if (row.on_hand_base_units != null && (!row.stock_date || !row.stock_reason)) {
      throw new Error(`Row ${index + 2}: on-hand total needs Stock Date and Stock Reason.`)
    }
    if (row.cost_per_base_unit != null && (!row.cost_effective_date || !row.cost_note)) {
      throw new Error(`Row ${index + 2}: cost needs Cost Date and Cost Note.`)
    }
    if (['price', 'package', 'logistics', 'addons', 'profit_percentage', 'misc_total',
      'cr_percentage', 'cr_cost', 'reverse_shipping_charge', 'damage_percentage', 'damage_cost'].some(field => row[field] != null) && !row.platform) {
      throw new Error(`Row ${index + 2}: Unit Economics values need Platform.`)
    }
    rows.push(row)
  }
  if (!rows.length) { throw new Error('The file has no product rows.') }
  if (rows.length > 500) { throw new Error('Upload at most 500 product rows at a time.') }
  const seen = new Map()
  const identityFields = COLUMNS.map(([, field]) => field).filter(field =>
    !['operation', 'shringar_sku', 'platform', ...NUMBERS].includes(field))
    .concat(['base_units_per_sku', 'on_hand_base_units', 'cost_per_base_unit',
      'is_active', 'stock_date', 'cost_effective_date', 'gst'])
  const priceFields = ['price', 'package', 'logistics', 'addons', 'profit_percentage',
    'misc_total', 'cr_percentage', 'cr_cost', 'reverse_shipping_charge', 'damage_percentage', 'damage_cost']
  rows.forEach((row, index) => {
    const platforms = seen.get(row.shringar_sku)
    const platform = row.platform?.toLowerCase()
    if (platforms) {
      if (row.operation !== 'update' || !platform || platforms.has(platform) ||
          identityFields.some(field => row[field] != null) ||
          !priceFields.some(field => row[field] != null)) {
        throw new Error(`Row ${index + 2}: repeated SKU must update a different platform's economics only.`)
      }
      platforms.add(platform)
    } else { seen.set(row.shringar_sku, new Set(platform ? [platform] : [])) }
  })
  return rows
}

export default function BulkProductImport({ onClose, onSaved }) {
  const [rows, setRows] = useState([])
  const [fileName, setFileName] = useState('')
  const [images, setImages] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const downloadTemplate = async () => {
    const XLSX = await import('xlsx')
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([HEADERS]), 'Products')
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ['Field', 'How to use it'],
      ['Operation', 'create adds a new SKU; update changes an existing SKU; delete deactivates it.'],
      ['SKU Code', 'Required on every row. For another platform, add an update row with only SKU, Platform and economics fields.'],
      ['Blank cells', 'Leave unchanged on update. Optional on create. Type <CLEAR> to clear text, vendor, category, HSN or image URL.'],
      ['Vendor / Category / Platform', 'Use existing names from the selected company.'],
      ['Stock Item / Units per SKU', 'Physical item name and number of base units in one sellable SKU.'],
      ['On Hand Base Units', 'Absolute physical count. Include Stock Date and Stock Reason. A movement records the difference.'],
      ['Cost per Base Unit', 'Approved cost for one physical base unit. Include Cost Date and Cost Note.'],
      ['Price / SKU', 'The Price input in Unit Economics for the named Platform.'],
      ['GST', 'Catalogue GST percentage for the SKU. Can be uploaded without Platform or Price / SKU.'],
      ['Reverse Shipping / Return', 'Optional SKU-specific charge for the named Platform. Blank inherits the platform charge; 0 overrides it with zero.'],
      ['Image URL', 'Public HTTPS image. The browser loads this URL directly.'],
      ['Image File', 'Filename of a JPEG, PNG or WebP chosen in the upload dialog. Maximum 5 MB per image.'],
    ]), 'Instructions')
    const blob = new Blob([XLSX.write(book, { type: 'array', bookType: 'xlsx' })],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = 'casper_catalogue_bulk.xlsx'
    document.body.append(link); link.click(); link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const readFile = async file => {
    if (!file) { return }
    setRows([]); setError(''); setFileName(file.name)
    if (!/\.(csv|xlsx)$/i.test(file.name)) { setError('Choose a .csv or .xlsx file.'); return }
    try {
      const XLSX = await import('xlsx')
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      if (!sheet) { throw new Error('The file has no worksheet.') }
      setRows(parseProductSheet(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })))
    } catch (cause) { setError(cause.message || 'Could not read the file.') }
  }
  const upload = async () => {
    if (!rows.length || busy) { return }
    const wanted = new Set(rows.filter(row => row.operation !== 'delete').map(row => row.image_file).filter(Boolean))
    const actual = new Set(images.map(file => file.name))
    if (images.some(file => file.size > 5 * 1024 * 1024)) { setError('Each image must be at most 5 MB.'); return }
    if (images.reduce((size, file) => size + file.size, 0) > 100 * 1024 * 1024) {
      setError('Image files must total at most 100 MB per upload.'); return
    }
    if (actual.size !== images.length || wanted.size !== actual.size || [...wanted].some(name => !actual.has(name))) {
      setError('Choose exactly the image files named in the sheet, with unique filenames.'); return
    }
    setBusy(true); setError('')
    try {
      const body = new FormData()
      body.append('payload', JSON.stringify({ rows }))
      images.forEach(file => body.append('files', file))
      onSaved(await applyCatalogueSheet(body))
    } catch (cause) {
      const detail = cause.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Could not apply sheet. No rows were saved.')
    } finally { setBusy(false) }
  }
  const counts = rows.reduce((result, row) => ({ ...result, [row.operation]: result[row.operation] + 1 }),
    { create: 0, update: 0, delete: 0 })

  return <ConfirmDialog open title="Bulk upload products" dialogRole="dialog" className="import-dialog catalogue-import"
    onCancel={() => !busy && onClose()} onConfirm={upload} confirmDisabled={!rows.length || busy}
    confirmLabel={busy ? 'Applying…' : `Apply ${rows.length} action${rows.length === 1 ? '' : 's'}`}>
    <p>Choose create, update or delete for each SKU. Delete deactivates the product. All rows succeed together or none are saved.</p>
    <div className="catalogue-import-controls">
      <button type="button" onClick={downloadTemplate}>Download Excel template</button>
      <label>Choose CSV or Excel file<input aria-label="Choose product file" type="file" accept=".csv,.xlsx"
        onChange={event => readFile(event.target.files?.[0])} /></label>
    </div>
    <label className="catalogue-images-picker">Product images named in the sheet (optional)
      <input aria-label="Choose product images" type="file" accept="image/jpeg,image/png,image/webp" multiple
        onChange={event => setImages([...event.target.files])} />
    </label>
    {fileName && <p>{fileName} · {rows.length} valid rows · {images.length} images selected</p>}
    {error && <p className="catalogue-error" role="alert">{error}</p>}
    {!!rows.length && <><p className="catalogue-import-summary">{counts.create} create · {counts.update} update · {counts.delete} deactivate</p>
      <div className="catalogue-import-preview"><table><thead><tr>
        {['Operation', 'SKU', 'Name', 'GST %', 'Platform', 'Price / SKU', 'Cost / Base Unit', 'On Hand', 'Image'].map(label => <th key={label}>{label}</th>)}
      </tr></thead><tbody>{rows.slice(0, 10).map(row => <tr key={row.shringar_sku}>
        <td>{row.operation}</td><td>{row.shringar_sku}</td><td>{row.display_name || '—'}</td>
        <td>{row.gst ?? '—'}</td><td>{row.platform || '—'}</td><td>{row.price ?? '—'}</td>
        <td>{row.cost_per_base_unit ?? '—'}</td><td>{row.on_hand_base_units ?? '—'}</td>
        <td>{row.image_file || row.image_url || '—'}</td>
      </tr>)}</tbody></table>{rows.length > 10 && <p>Showing first 10 of {rows.length} rows.</p>}</div></>}
  </ConfirmDialog>
}
