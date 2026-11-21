import { vi, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InvoiceReceipts from '../components/InvoiceReceipts'
import api from '../api/client'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() }, errText: (_e, fallback) => fallback }))
beforeEach(() => {vi.resetAllMocks(); api.get.mockResolvedValue({ data: [] })})
const invoice = { id: 5, number: 'INV-5', amount_paid: 0, balance: 100 }

it('records a dated receipt and reuses its request key after a failed response', async () => {
  api.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { id: 1 } })
  const saved = vi.fn(), closed = vi.fn()
  render(<InvoiceReceipts invoice={invoice} onSaved={saved} onClose={closed} />)
  await userEvent.click(screen.getByRole('button', { name: 'Record receipt' }))
  await screen.findByRole('alert')
  await userEvent.click(screen.getByRole('button', { name: 'Record receipt' }))
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
  expect(api.post.mock.calls[0][1]).toEqual(api.post.mock.calls[1][1])
  expect(api.post.mock.calls[0][1]).toMatchObject({ amount: 100, payment_method: 'bank_transfer' })
  expect(api.post.mock.calls[0][1].receipt_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
})

it('requires explicit confirmation before posting a receipt reversal', async () => {
  api.get.mockResolvedValue({ data: [{ id: 8, amount: 100, receipt_date: '2026-01-01', reversed: false }] })
  api.post.mockResolvedValue({ data: { reversed: true } })
  render(<InvoiceReceipts invoice={{ ...invoice, amount_paid: 100, balance: 0 }} onSaved={vi.fn()} onClose={vi.fn()} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Reverse receipt #8' }))
  expect(api.post).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Confirm reversal' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/billing/receipts/8/reverse', expect.objectContaining({ reversal_date: expect.any(String) })))
})
