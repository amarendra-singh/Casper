import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SKUs from '../pages/SKUs'
import { MemoryRouter } from 'react-router-dom'
import { getEntries, upsertBatch } from '../api/client'
import { writeFile } from 'xlsx'
vi.mock('xlsx', () => ({
  utils: { aoa_to_sheet: vi.fn(() => ({ '!ref': 'A1:B2' })), decode_range: vi.fn(() => ({ s: { c: 0 }, e: { c: 1 } })),
    encode_cell: vi.fn(() => 'A1'), book_new: vi.fn(() => ({})), book_append_sheet: vi.fn() },
  writeFile: vi.fn(),
}))

vi.mock('../context/CompanyContext', () => ({
  useCompany: () => ({ isAll: false, role: 'owner' }),
}))
vi.mock('../api/client', () => ({
  getVendors: vi.fn(async () => []),
  getCategories: vi.fn(async () => []),
  getPlatforms: vi.fn(async () => []),
  getMiscTotal: vi.fn(async () => ({ total: 0 })),
  getSettings: vi.fn(async () => []),
  getUnmatchedSkus: vi.fn(async () => []),
  getEntries: vi.fn(async () => [
    {
      sku_id: 1,
      shringar_sku: 'TEST-SKU',
      price: 100,
      package: 0,
      logistics: 0,
      gst: 0,
      profit_percentage: 20,
      platform_configs: [],
    },
  ]),
  upsertBatch: vi.fn(),
  deleteSku: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  createVendor: vi.fn(),
  createCategory: vi.fn(),
  errText: vi.fn((_e, fallback) => fallback),
  default: { post: vi.fn() },
}))

afterEach(() => vi.useRealTimers())
beforeEach(() => upsertBatch.mockReset())

it('shows inactive catalogue SKUs without creating a price or activating them', async () => {
  getEntries.mockResolvedValueOnce([{ id: 9, shringar_sku: 'IMPORTED-P1', is_active: false,
    price: null, platform_configs: [] }])
  const view = render(<MemoryRouter><SKUs /></MemoryRouter>)
  await waitFor(() => expect(view.container.querySelector('td.w-sku input')).toHaveValue('IMPORTED-P1'))
  expect(getEntries).toHaveBeenCalledWith({ include_inactive: true })
  expect(screen.getAllByText('Inactive').length).toBeGreaterThan(0)
  expect(view.container.querySelector('td.w-price input')).toHaveValue(null)
  expect(view.container.querySelector('td.w-price input')).toHaveAttribute('placeholder', '—')
  expect(screen.getByText(/1 awaiting price/)).toBeInTheDocument()
  expect(view.container.querySelector('td.w-cramt input')).toHaveAttribute('placeholder', '—')
  expect(upsertBatch).not.toHaveBeenCalled()
})

it('persists an absolute profit edit as the equivalent markup instead of reverting to the default', async () => {
  upsertBatch.mockReset().mockResolvedValue({ saved: [{ shringar_sku: 'TEST-SKU', sku_id: 1 }], errors: [] })
  const view = render(<MemoryRouter><SKUs /></MemoryRouter>)
  await waitFor(() => expect(view.container.querySelector('td.w-price input')).toHaveValue(100))
  vi.useFakeTimers()
  const amount = view.container.querySelector('td.w-profamt input')
  expect(amount).not.toBeNull()
  fireEvent.change(amount, { target: { value: '75' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  const sent = upsertBatch.mock.calls[0][0][0]
  // This fixture has 100 purchase cost, zero platform CR and 15% damage.
  expect(sent.profit_percentage).toBeCloseTo(75 / 115 * 100, 8)
})

describe('committed revision feedback', () => {
  it('keeps edits dirty while an earlier save completes, then saves the newer price', async () => {
    let finishFirst
    upsertBatch
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finishFirst = resolve
          }),
      )
      .mockResolvedValueOnce({ saved: [{ shringar_sku: 'TEST-SKU', sku_id: 1 }], errors: [] })
    const view = render(<MemoryRouter><SKUs /></MemoryRouter>)
    await waitFor(() => expect(view.container.querySelector('td.w-price input')).toHaveValue(100))
    vi.useFakeTimers()
    const price = view.container.querySelector('td.w-price input')
    fireEvent.change(price, { target: { value: '200' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(upsertBatch).toHaveBeenCalledTimes(1)
    expect(upsertBatch.mock.calls[0][0][0].price).toBe(200)
    fireEvent.change(price, { target: { value: '300' } })
    await act(async () =>
      finishFirst({ saved: [{ shringar_sku: 'TEST-SKU', sku_id: 1 }], errors: [] }),
    )
    expect(price).toHaveValue(300)
    expect(screen.queryByText('✓ All saved')).not.toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(upsertBatch).toHaveBeenCalledTimes(2)
    expect(upsertBatch.mock.calls[1][0][0].price).toBe(300)
    expect(screen.getByText('✓ All saved')).toBeInTheDocument()
  })
})


it('exports XLSX through the loaded spreadsheet module', async () => {
  const view = render(<MemoryRouter><SKUs /></MemoryRouter>)
  await waitFor(() => expect(view.container.querySelector('td.w-price input')).toHaveValue(100))
  fireEvent.click(screen.getByRole('button', { name: '↑ Export ▾' }))
  fireEvent.click(screen.getByRole('button', { name: '📤 Export as .xlsx' }))
  await waitFor(() => expect(writeFile).toHaveBeenCalledOnce())
  expect(writeFile.mock.calls[0][1]).toMatch(/^casper_skus_.*\.xlsx$/)
})
