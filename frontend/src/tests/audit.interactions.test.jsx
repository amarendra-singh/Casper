import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect } from 'vitest'
import ConfirmDialog from '../components/ConfirmDialog'
import SmartCell from '../components/SmartCell'
import { csvCell, localDate, rowFingerprint } from '../lib/format'

describe('audit interaction regressions', () => {
  it('Cancel + Enter cancels without confirming and restores trigger focus', async () => {
    const user = userEvent.setup()
    const confirm = vi.fn(),
      cancel = vi.fn()
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const view = render(
      <ConfirmDialog open title="Remove member" tone="danger" onConfirm={confirm} onCancel={cancel}>
        Remove the member?
      </ConfirmDialog>,
    )
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(cancel).toHaveBeenCalledOnce()
    expect(confirm).not.toHaveBeenCalled()
    view.unmount()
    expect(trigger).toHaveFocus()
    trigger.remove()
  })

  it('keeps dialog focus inside and confirms exactly once with native Enter', async () => {
    const user = userEvent.setup(),
      confirm = vi.fn()
    render(
      <ConfirmDialog open title="Confirm" tone="danger" onConfirm={confirm} onCancel={() => {}}>
        Details
      </ConfirmDialog>,
    )
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(confirm).toHaveBeenCalledOnce()
  })

  it('allows Tab to leave an autocomplete with no matching option', async () => {
    const user = userEvent.setup()
    render(
      <>
        <SmartCell
          value="NO MATCH"
          options={[{ label: 'Existing SKU' }]}
          placeholder="Search SKU"
        />
        <button>Next control</button>
      </>,
    )
    await user.click(screen.getByRole('combobox'))
    await user.tab()
    expect(screen.getByRole('button', { name: 'Next control' })).toHaveFocus()
  })

  it('read-only autocomplete never invokes selection', async () => {
    const user = userEvent.setup(),
      select = vi.fn()
    render(
      <SmartCell
        readOnly
        value="Existing"
        options={[{ label: 'Existing SKU' }]}
        onSelect={select}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    await user.keyboard('{ArrowDown}{Enter}')
    expect(select).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('escapes CSV quotes and newlines and preserves local dates', () => {
    expect(csvCell('ACME, "North"')).toBe('"ACME, ""North"""')
    expect(csvCell('one\ntwo')).toBe('"one\ntwo"')
    expect(localDate(new Date(2026, 9, 4, 1, 0))).toBe('2026-10-04')
  })

  it('ignores save metadata while distinguishing unsent row edits', () => {
    expect(rowFingerprint({ id: 1, price: '100', status: 'dirty' })).toBe(
      rowFingerprint({ id: 1, price: '100', status: 'saving', skuId: 10 }),
    )
    expect(rowFingerprint({ id: 1, price: '100' })).not.toBe(
      rowFingerprint({ id: 1, price: '200' }),
    )
  })
})
