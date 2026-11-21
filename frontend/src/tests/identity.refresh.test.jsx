import { vi, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PricingRefresh from '../components/PricingRefresh'
import { HiddenSkuPanel } from '../pages/PnL/flipkart/ProfitLossView'
import * as api from '../api/client'

vi.mock('../api/client', () => ({ previewPricingRefresh: vi.fn(), applyPricingRefresh: vi.fn(),
  getEntries: vi.fn(), getUnmatchedSkus: vi.fn(), getVendors: vi.fn(), getCategories: vi.fn(),
  linkMarketplaceSku: vi.fn(), getPnlRows: vi.fn(), rematchPnlReport: vi.fn(), addHiddenSkuPricing: vi.fn(),
  errText: (_e, fallback) => fallback }))
beforeEach(() => vi.resetAllMocks())

it('requires a reviewed preview before applying derived costs', async () => {
  api.previewPricingRefresh.mockResolvedValue({ token: 'preview-token', updates: [{ id: 1, sku: 'A', platform_id: 2,
    changes: { misc_total: { before: 0, after: 15 } } }] })
  api.applyPricingRefresh.mockResolvedValue({ updated: 1, rows_matched: 0 })
  const onApplied = vi.fn()
  render(<PricingRefresh onApplied={onApplied} />)
  expect(screen.queryByRole('button', { name: 'Apply reviewed changes' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Preview recalculation' }))
  expect(await screen.findByText('misc total: 0 → 15')).toBeInTheDocument()
  expect(api.applyPricingRefresh).not.toHaveBeenCalled()
  expect(onApplied).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Apply reviewed changes' }))
  await waitFor(() => expect(api.applyPricingRefresh).toHaveBeenCalledWith('preview-token'))
  await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1))
})

it('links the chosen existing product ID instead of creating another product', async () => {
  api.getEntries.mockResolvedValue([{ id: 162, shringar_sku: 'PKTY-1P' }])
  api.getUnmatchedSkus.mockResolvedValue([{ platform_sku_name: 'Candy tray listing', units: 3, payout: 500 }])
  api.getVendors.mockResolvedValue([]); api.getCategories.mockResolvedValue([])
  api.linkMarketplaceSku.mockResolvedValue({ rows_matched: 1, remaining_hidden: 0 })
  const matched = vi.fn()
  render(<HiddenSkuPanel reportId={7} onClose={vi.fn()} onMatched={matched} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Add cost' }))
  await userEvent.type(screen.getByRole('combobox', { name: 'Link existing product' }), 'PKTY')
  await userEvent.click(await screen.findByRole('option', { name: 'PKTY-1P' }))
  await userEvent.click(screen.getByRole('button', { name: 'Link product & connect cost' }))
  await waitFor(() => expect(api.linkMarketplaceSku).toHaveBeenCalledWith({ report_id: 7, sku_id: 162, platform_sku_name: 'Candy tray listing' }))
  expect(api.addHiddenSkuPricing).not.toHaveBeenCalled()
})
