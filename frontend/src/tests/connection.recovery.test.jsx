import { vi, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BillCostSetup from '../components/BillCostSetup'
import FinancialHistory from '../components/FinancialHistory'
import { getPlatforms, createPricing, getFinancialHistory, undoFinancialChange } from '../api/client'

vi.mock('../context/CompanyContext', () => ({ useCompany: () => ({ role: 'owner', isAll: false, activeId: 1 }) }))
vi.mock('../api/client', () => ({ getPlatforms: vi.fn(), createPricing: vi.fn(),
  getFinancialHistory: vi.fn(), undoFinancialChange: vi.fn(), errText: (_e, fallback) => fallback }))
beforeEach(() => {
  vi.resetAllMocks()
  getPlatforms.mockResolvedValue([{ id: 1, name: 'Flipkart', is_active: true }])
})

it('requires explicit bill cost allowances and saves the confirmed per-unit cost', async () => {
  const saved = vi.fn()
  createPricing.mockResolvedValue({ id: 9 })
  render(<BillCostSetup line={{ sku_id: 162, sku_code: 'PKTY', unit_cost: 45, pack_multiple: 6 }} onSave={saved} onClose={vi.fn()} />)
  const save = screen.getByRole('button', { name: 'Save cost & connect reports' })
  expect(save).toBeDisabled()
  await userEvent.click(screen.getByRole('combobox', { name: 'Pricing platform' }))
  await userEvent.click(await screen.findByRole('option', { name: 'Flipkart' }))
  for (const label of ['Packaging', 'Logistics', 'Add-ons', 'Miscellaneous', 'Return allowance', 'Damage allowance', 'GST %', 'Target markup %']) {
    await userEvent.type(screen.getByRole('spinbutton', { name: label }), '0')
  }
  await userEvent.click(save)
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
  expect(createPricing).toHaveBeenCalledWith(expect.objectContaining({ sku_id: 162, platform_id: 1, price: 45, gst: 0, cr_cost: 0 }))
})

it('confirms undo and refreshes history only after the API succeeds', async () => {
  getFinancialHistory.mockResolvedValue([{ id: 5, entity_type: 'sku_pricing', entity_id: 1,
    action: 'update', created_at: '2026-10-07T00:00:00', before: { price: 100 }, after: { price: 123 }, undo_available: true }])
  undoFinancialChange.mockResolvedValue({ ok: true })
  render(<FinancialHistory />)
  await userEvent.click(await screen.findByRole('button', { name: 'Undo edit' }))
  expect(undoFinancialChange).not.toHaveBeenCalled()
  const buttons = screen.getAllByRole('button', { name: 'Undo edit' })
  await userEvent.click(buttons.at(-1))
  await waitFor(() => expect(undoFinancialChange).toHaveBeenCalledWith(5))
  await waitFor(() => expect(getFinancialHistory).toHaveBeenCalledTimes(2))
})
