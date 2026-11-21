import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Catalogue, { groupPackVariants } from '../pages/Product/Catalogue'
import { parseProductSheet } from '../pages/Product/BulkProductImport'
import { getCatalogue, getPlatforms, createSku, applyCatalogueSheet } from '../api/client'

vi.mock('../context/CompanyContext', () => ({ useCompany: () => ({ activeId: 8, isAll: false, role: 'owner' }) }))
vi.mock('../api/client', () => ({
  getCatalogue: vi.fn(), getPlatforms: vi.fn(), createSku: vi.fn(), applyCatalogueSheet: vi.fn(),
}))

const product = (id, suffix, company_id = 8) => ({ id, company_id,
  our_sku: `MBG-WG-AMR-325-${suffix}`, name: `MBG-WG-AMR-325-${suffix}`,
  cost_source: 'missing', is_active: true })
const products = [product(1, 'P1'), product(2, 'P2'), product(3, 'P4'), product(4, 'P6'), product(5, 'P8')]

const renderCatalogue = () => render(<MemoryRouter initialEntries={['/product/catalogue']}><Routes>
  <Route path="/product/catalogue" element={<Catalogue />} />
  <Route path="/product/catalogue/:skuId" element={<p>Product profile route</p>} />
</Routes></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  getPlatforms.mockResolvedValue([])
  getCatalogue.mockResolvedValue({ items: products, total: 5, page_size: 40 })
})

it('groups only matching pack suffixes within the same company', () => {
  const groups = groupPackVariants([...products, product(6, 'P1', 9), { id: 7, company_id: 8, our_sku: 'OTHER-1B' }])
  expect(groups.map(group => group.items.length)).toEqual([5, 1, 1])
  expect(groups[0].items.map(item => item.our_sku)).toEqual(products.map(item => item.our_sku))
})

it('expands packs by default and can collapse their actual SKU rows', async () => {
  renderCatalogue()
  const group = await within(screen.getByRole('table')).findByRole('button', { name: /MBG-WG-AMR-325/ })
  expect(group).toHaveAttribute('aria-expanded', 'true')
  expect(within(screen.getByRole('table')).getByRole('link', { name: /MBG-WG-AMR-325-P1/ })).toBeInTheDocument()
  await userEvent.click(group)
  expect(group).toHaveAttribute('aria-expanded', 'false')
  expect(within(screen.getByRole('table')).queryByRole('link', { name: /MBG-WG-AMR-325-P1/ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Expand packs' }))
  expect(group).toHaveAttribute('aria-expanded', 'true')
  expect(within(screen.getByRole('table')).getByRole('link', { name: /MBG-WG-AMR-325-P8/ })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Collapse packs' }))
  expect(group).toHaveAttribute('aria-expanded', 'false')
})

it('adds a product from Catalogue and opens its profile', async () => {
  createSku.mockResolvedValue({ id: 71 })
  renderCatalogue()
  await userEvent.click(await screen.findByRole('button', { name: '+ Add product' }))
  const dialog = screen.getByRole('dialog', { name: 'Add product' })
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Our SKU' }), 'glass-p1')
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Product name' }), 'Single glass')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add product' }))
  await waitFor(() => expect(createSku).toHaveBeenCalledWith({
    shringar_sku: 'glass-p1', display_name: 'Single glass', vendor_sku: null, description: null,
  }))
  expect(await screen.findByText('Product profile route')).toBeInTheDocument()
})

it('saves an optional platform reverse shipping charge when adding a SKU', async () => {
  getPlatforms.mockResolvedValue([{ id: 4, name: 'Flipkart', cr_charge: 90 }])
  createSku.mockResolvedValue({ id: 72 })
  renderCatalogue()
  await userEvent.click(await screen.findByRole('button', { name: '+ Add product' }))
  const dialog = screen.getByRole('dialog', { name: 'Add product' })
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Our SKU' }), 'glass-p2')
  await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Reverse shipping platform' }), '4')
  await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Reverse shipping charge per return' }), '0')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add product' }))
  await waitFor(() => expect(createSku).toHaveBeenCalledWith(expect.objectContaining({
    shringar_sku: 'glass-p2', reverse_shipping_platform_id: 4, reverse_shipping_charge: 0,
  })))
})

it('requires explicit operations, valid cost provenance and unique SKU codes', () => {
  expect(() => parseProductSheet([['SKU Code', 'Product Cost ₹'], ['G-P1', 270]])).toThrow(/Operation/)
  expect(() => parseProductSheet([['Operation', 'SKU Code', 'Cost per Base Unit'], ['create', 'G-P1', 270]])).toThrow(/Cost Date/)
  expect(() => parseProductSheet([['Operation', 'SKU Code'], ['create', 'G-P1'], ['update', 'g-p1']])).toThrow(/repeated SKU/)
})

it('allows a second row to update a different platform for the same SKU', () => {
  expect(parseProductSheet([['Operation', 'SKU Code', 'Platform', 'Price / SKU', 'Reverse Shipping / Return'],
    ['create', 'GLASS-P1', 'Flipkart', 50, 40], ['update', 'glass-p1', 'Meesho', 55, 0]])).toEqual([
    { operation: 'create', shringar_sku: 'GLASS-P1', platform: 'Flipkart', price: 50, reverse_shipping_charge: 40 },
    { operation: 'update', shringar_sku: 'GLASS-P1', platform: 'Meesho', price: 55, reverse_shipping_charge: 0 },
  ])
})

it('parses absolute stock, Unit Economics price, dates and public image URLs', () => {
  expect(parseProductSheet([['Operation', 'SKU Code', 'Stock Item', 'Units per SKU',
    'On Hand Base Units', 'Stock Date', 'Stock Reason', 'Platform', 'Price / SKU', 'Image URL'],
  ['update', 'glass-p4', 'Glass', 4, 12, new Date('2026-10-22T00:00:00Z'),
    'Physical count', 'Flipkart', 270, 'https://example.com/glass.png']])).toEqual([{
    operation: 'update', shringar_sku: 'GLASS-P4', stock_item: 'Glass',
    base_units_per_sku: 4, on_hand_base_units: 12, stock_date: '2026-10-22',
    stock_reason: 'Physical count', platform: 'Flipkart', price: 270,
    image_url: 'https://example.com/glass.png',
  }])
})

it('accepts Catalogue GST without a platform or a product cost', () => {
  expect(parseProductSheet([
    ['Operation', 'SKU Code', 'GST'],
    ['update', 'glass-p1', 18],
  ])).toEqual([{ operation: 'update', shringar_sku: 'GLASS-P1', gst: 18 }])
  expect(() => parseProductSheet([
    ['Operation', 'SKU Code', 'GST'], ['update', 'glass-p1', 101],
  ])).toThrow(/GST/)
})

it('previews and uploads a product CSV from Catalogue', async () => {
  applyCatalogueSheet.mockResolvedValue({ created: 1, updated: 0, deactivated: 0 })
  renderCatalogue()
  await userEvent.click(await screen.findByRole('button', { name: 'Bulk upload' }))
  const dialog = screen.getByRole('dialog', { name: 'Bulk upload products' })
  const csv = 'Operation,SKU Code,Product Name,Vendor SKU,Vendor,Category,Description\ncreate,GLASS-P1,Single glass,G-1,,,Single piece\n'
  const file = new File([csv], 'products.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(csv).buffer })
  await userEvent.upload(within(dialog).getByLabelText('Choose product file'), file)
  expect(await within(dialog).findByText('Single glass')).toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply 1 action' }))
  await waitFor(() => expect(applyCatalogueSheet).toHaveBeenCalled())
  const body = applyCatalogueSheet.mock.calls[0][0]
  expect(JSON.parse(body.get('payload')).rows).toEqual([{
    operation: 'create', shringar_sku: 'GLASS-P1', display_name: 'Single glass',
    vendor_sku: 'G-1', description: 'Single piece',
  }])
  expect(await screen.findByRole('status')).toHaveTextContent('1 created')
})
