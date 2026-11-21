import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import Ledger from '../pages/Ledger'
import BillDiscrepancies from '../components/BillDiscrepancies'
import { getLedger, getLedgerSummary, checkBillDiscrepancies, getSkus, getBillSkuOptions, editBillRow, getPurchaseBills, linkBillLine, autoMatchPurchaseBills, createSku } from '../api/client'

vi.mock('../context/CompanyContext', () => ({ useCompany: () => ({ companies: [], isAll: false, role: 'owner' }) }))
vi.mock('recharts', () => Object.fromEntries(
  ['PieChart', 'Pie', 'Cell', 'BarChart', 'Bar', 'XAxis', 'YAxis', 'Tooltip', 'ResponsiveContainer', 'Legend']
    .map(name => [name, () => null]),
))
vi.mock('../api/client', () => ({
  getLedger: vi.fn(), getLedgerSummary: vi.fn(), getVendors: vi.fn(async () => []),
  getBillSkuOptions: vi.fn(), editBillRow: vi.fn(),
  getSkus: vi.fn(async () => []), getPurchaseBills: vi.fn(async () => []),
  checkBillDiscrepancies: vi.fn(), linkBillLine: vi.fn(), applyBillCost: vi.fn(),
  autoMatchPurchaseBills: vi.fn(), createSku: vi.fn(),
  createLedgerEntry: vi.fn(), updateLedgerEntry: vi.fn(), deleteLedgerEntry: vi.fn(),
  inCompany: vi.fn(), errText: (_error, fallback) => fallback,
}))

beforeEach(() => {
  window.history.replaceState({}, '', '/ledger')
  vi.clearAllMocks()
  getLedger.mockResolvedValue([])
  getLedgerSummary.mockResolvedValue({ total_income: 0, total_expense: 0, net: 0, count: 0, by_category: [] })
  getSkus.mockResolvedValue([])
  getBillSkuOptions.mockImplementation(() => getSkus())
  getPurchaseBills.mockResolvedValue([])
  autoMatchPurchaseBills.mockResolvedValue({ matched: 0 })
})

it('reconsiders saved supplier mappings on load and explains pack candidates', async () => {
  autoMatchPurchaseBills.mockResolvedValue({ matched: 2 })
  getPurchaseBills.mockResolvedValue([{ id: 1, ref_no: 'fixture', lines: [{ id: 11, item_name: 'BRILLIANT', pack_multiple: 1,
    candidates: [{ id: 1, code: 'BRL-P1' }, { id: 2, code: 'BRL-P6' }], match_reason: 'Choose the SKU variant and confirm the billed-unit conversion' }] }])
  const onSaved = vi.fn()
  render(<BillDiscrepancies onSaved={onSaved} />)
  expect(await screen.findByText(/2 candidates: Choose the SKU variant/)).toBeInTheDocument()
  expect(autoMatchPurchaseBills).toHaveBeenCalledTimes(1)
  expect(onSaved).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status')).toHaveTextContent('2 lines matched')
  expect(linkBillLine).not.toHaveBeenCalled()
})

it('finds supplier products by description and saves the selected SKU ID', async () => {
  getSkus.mockResolvedValue([{ id: 71, shringar_sku: 'MBG-WG-AMR-325-P8', vendor_sku: 'AMORE WHISKY', description: 'Crystal tumbler' }])
  getPurchaseBills.mockResolvedValue([{ id: 1, ref_no: 'fixture', lines: [{ id: 11, item_name: 'Supplier item', pack_multiple: 1 }] }])
  linkBillLine.mockResolvedValue({ ok: true })
  render(<BillDiscrepancies />)
  const input = await screen.findByRole('combobox', { name: 'search SKU…' })
  await userEvent.type(input, '  crystal tumbler ')
  const option = await screen.findByRole('option', { name: /MBG-WG-AMR-325-P8/ })
  await userEvent.click(option)
  expect(linkBillLine).toHaveBeenCalledWith(11, { sku_id: 71, pack_multiple: 1, remember: true })
})

it('refreshes the supplier search catalogue without reopening the page', async () => {
  getPurchaseBills.mockResolvedValue([{ id: 1, ref_no: 'fixture', lines: [{ id: 11, item_name: 'Supplier item', pack_multiple: 1 }] }])
  render(<BillDiscrepancies />)
  const input = await screen.findByRole('combobox', { name: 'search SKU…' })
  await userEvent.type(input, 'AMORE')
  expect(screen.getByRole('option', { name: /Create SKU/ })).toBeInTheDocument()
  getSkus.mockResolvedValue([{ id: 71, shringar_sku: 'MBG-WG-AMR-325-P8', vendor_sku: 'AMORE WHISKY' }])
  await userEvent.click(screen.getByRole('button', { name: 'Refresh SKUs' }))
  await userEvent.click(input)
  expect(await screen.findByRole('option', { name: /MBG-WG-AMR-325-P8/ })).toBeInTheDocument()
})

it('searches ledger entry SKUs by vendor code', async () => {
  getSkus.mockResolvedValue([{ id: 71, shringar_sku: 'MBG-WG-AMR-325-P8', vendor_sku: 'AMORE WHISKY' }])
  render(<BrowserRouter><Ledger /></BrowserRouter>)
  await screen.findByText(/No data yet.*add entries to see reports/)
  await userEvent.click(screen.getByRole('button', { name: '+ New entry' }))
  await userEvent.type(screen.getByRole('combobox', { name: 'SKU' }), 'AMORE')
  await userEvent.click(await screen.findByRole('option', { name: /MBG-WG-AMR-325-P8/ }))
  expect(screen.getByRole('combobox', { name: 'SKU' })).toHaveValue('MBG-WG-AMR-325-P8')
})

it('retains uploaded files and confirmation while refreshing ledger totals', async () => {
  let finishRefresh
  getLedger.mockResolvedValueOnce([]).mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve }))
  checkBillDiscrepancies.mockResolvedValue({ orders: [], saved: { bills_created: 1, bills_updated: 0 } })
  render(<BrowserRouter><Ledger /></BrowserRouter>)
  await screen.findByText(/No data yet.*add entries to see reports/)
  await userEvent.click(screen.getByRole('button', { name: 'Bill Discrepancies' }))
  const file = new File(['fixture'], 'synthetic-bill.pdf', { type: 'application/pdf' })
  await userEvent.upload(screen.getAllByLabelText('Choose file')[1], file)
  await userEvent.click(screen.getByRole('button', { name: 'Upload & match' }))
  await waitFor(() => expect(getLedger).toHaveBeenCalledTimes(2))
  expect(screen.getByText('synthetic-bill.pdf')).toBeInTheDocument()
  finishRefresh([])
  expect(await screen.findByText('1 bills added, 0 updated.')).toBeInTheDocument()
  expect(screen.getByText('synthetic-bill.pdf')).toBeInTheDocument()
})


it('keeps the selected ledger section across remounts and preserves other URL parameters', async () => {
  window.history.replaceState({}, '', '/ledger?company=8')
  const view = render(<BrowserRouter><Ledger /></BrowserRouter>)
  await screen.findByText(/No data yet.*add entries to see reports/)
  await userEvent.click(screen.getByRole('button', { name: 'Bill Discrepancies' }))
  expect(new URLSearchParams(window.location.search).get('tab')).toBe('discrepancies')
  expect(new URLSearchParams(window.location.search).get('company')).toBe('8')
  view.unmount()
  render(<BrowserRouter><Ledger /></BrowserRouter>)
  expect(await screen.findByRole('button', { name: 'Refresh SKUs' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Bill Discrepancies' })).toHaveClass('on')
})

it('opens Entries directly and falls back to Reports for an unknown section', async () => {
  window.history.replaceState({}, '', '/ledger?tab=entries')
  const view = render(<BrowserRouter><Ledger /></BrowserRouter>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Entries' })).toHaveClass('on'))
  view.unmount()
  window.history.replaceState({}, '', '/ledger?tab=invalid')
  render(<BrowserRouter><Ledger /></BrowserRouter>)
  expect(await screen.findByText(/No data yet.*add entries to see reports/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Reports' })).toHaveClass('on')
})


it('creates a missing SKU with an explicit conversion and retries a failed link without duplicates', async () => {
  getPurchaseBills.mockResolvedValue([{ id: 1, vendor_id: 2, party_name: 'JDS Enterprise', ref_no: 'fixture',
    lines: [{ id: 11, item_name: 'PKTY-26 tray', pack_multiple: 1 }] }])
  createSku.mockResolvedValue({ id: 99, shringar_sku: 'TRAY-P1', vendor_sku: 'PKTY-26' })
  linkBillLine.mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce({ ok: true })
  render(<BillDiscrepancies />)
  await userEvent.type(await screen.findByRole('combobox', { name: /search SKU/ }), 'TRAY-P1')
  await userEvent.click(screen.getByRole('option', { name: /Create SKU/ }))
  expect(screen.getByRole('button', { name: 'Create & match' })).toBeDisabled()
  await userEvent.type(screen.getByLabelText('Vendor product code (optional)'), 'PKTY-26')
  await userEvent.type(screen.getByLabelText('SKU units per billed unit'), '6')
  await userEvent.click(screen.getByRole('button', { name: 'Create & match' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('SKU created, but linking failed')
  expect(createSku).toHaveBeenCalledWith({ shringar_sku: 'TRAY-P1', vendor_sku: 'PKTY-26', vendor_id: 2, description: 'PKTY-26 tray' })
  await userEvent.click(screen.getByRole('button', { name: 'Retry linking' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(createSku).toHaveBeenCalledTimes(1)
  expect(linkBillLine).toHaveBeenLastCalledWith(11, { sku_id: 99, pack_multiple: 6, remember: true })
})


it('edits bill amount and quantity with a calculated price', async () => {
  getPurchaseBills.mockResolvedValue([{ id: 1, bill_date: '2026-10-19', ref_no: 'A1', lines: [{ id: 11, sku_id: 71,
    item_name: 'Glass', sku_code: 'GLASS-P6', match_source: 'manual', pack_multiple: 1, unit: 'box', pieces_per_unit: 4,
    quantity: 6, amount: 900, stock_item_id: 5, base_units_per_sku: 6 }] }])
  editBillRow.mockResolvedValue({})
  render(<BrowserRouter><BillDiscrepancies /></BrowserRouter>)
  expect(await screen.findByLabelText('Rate')).toHaveValue(150)
  expect(screen.getByText('₹37.5')).toBeInTheDocument()
  await userEvent.clear(screen.getByLabelText('Amount'))
  await userEvent.type(screen.getByLabelText('Amount'), '1200')
  expect(screen.getByLabelText('Rate')).toHaveValue(200)
  expect(screen.getByText('₹50')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Save row' }))
  await waitFor(() => expect(editBillRow).toHaveBeenCalledWith(11, {
    bill_date: '2026-10-19', ref_no: 'A1', item_name: 'Glass', quantity: 6, amount: 1200, unit: 'box', pieces_per_unit: 4 }))
  expect(screen.getByLabelText('Type')).toHaveValue('box')
  expect(screen.queryByText('Legacy conversion')).not.toBeInTheDocument()
})


it('hides Units for Piece and uses the whole rate as unit cost', async () => {
  getPurchaseBills.mockResolvedValue([{ id: 1, bill_date: '2026-10-19', ref_no: 'A1', lines: [{
    id: 11, item_name: 'Single glass', quantity: 1, amount: 270, price_unit: 270, unit: 'piece', pieces_per_unit: 1,
  }] }])
  render(<BrowserRouter><BillDiscrepancies /></BrowserRouter>)
  expect(await screen.findByLabelText('Type')).toHaveValue('piece')
  expect(screen.queryByLabelText('Units')).not.toBeInTheDocument()
  expect(screen.getByText('₹270')).toBeInTheDocument()
})

it('recalculates the displayed difference when Type changes before saving', async () => {
  getPurchaseBills.mockResolvedValue([{ id: 1, bill_date: '2026-10-19', ref_no: 'A1', lines: [{
    id: 11, item_name: 'Glass', quantity: 1, amount: 270, price_unit: 270,
    unit: 'box', pieces_per_unit: 4, sku_id: 71, sku_code: 'GLASS-P1',
    match_source: 'manual', base_units_per_sku: 1, recorded_cost: 67.5,
    platform_costs: [{ platform_id: 1, price: 67.5 }],
  }] }])
  render(<BrowserRouter><BillDiscrepancies /></BrowserRouter>)
  expect(await screen.findByText('match')).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Type'), 'piece')
  expect(screen.queryByLabelText('Units')).not.toBeInTheDocument()
  expect(screen.getByText('+₹202.5')).toBeInTheDocument()
  expect(screen.queryByText('match')).not.toBeInTheDocument()
})
