import { useEffect, useRef, useState } from 'react'
import './ConfirmDialog.css'

/**
 * In-app confirmation.
 *
 * Replaces window.confirm, which renders the browser's own "localhost:5173 says"
 * box — unstyled, unbranded, and unable to show anything but plain text. Same
 * reason the company-create prompt was replaced earlier.
 *
 * Controlled, not promise-based: the caller keeps the pending action in state and
 * runs it in onConfirm, so the flow stays visible in the component that owns it.
 */
export default function ConfirmDialog({
  open, title, children, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  tone = 'default',            // 'default' | 'danger'
  onConfirm, onCancel,
}) {
  const confirmRef = useRef(null)

  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus()
    const onKey = e => {
      if (e.key === 'Escape') onCancel?.()
      if (e.key === 'Enter')  onConfirm?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onConfirm, onCancel])

  if (!open) return null

  return (
    <div className="cd-overlay" onClick={onCancel} role="presentation">
      <div className="cd-box" role="alertdialog" aria-modal="true" aria-label={title}
        onClick={e => e.stopPropagation()}>
        <div className="cd-title">{title}</div>
        <div className="cd-body">{children}</div>
        <div className="cd-actions">
          <button className="cd-btn cd-cancel" onClick={onCancel}>{cancelLabel}</button>
          <button ref={confirmRef} className={`cd-btn cd-confirm${tone === 'danger' ? ' danger' : ''}`}
            onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

/**
 * Convenience wrapper so a call site is two lines instead of its own state block.
 *
 *   const { ask, dialog } = useConfirm()
 *   ...
 *   <button onClick={() => ask({
 *     title: 'Delete invoice',
 *     body: <>Delete <strong>{inv.number}</strong>? This cannot be undone.</>,
 *     confirmLabel: 'Delete', tone: 'danger',
 *     onConfirm: () => remove(inv),
 *   })}>Delete</button>
 *   ...
 *   {dialog}
 *
 * The action runs after the dialog closes, so an async handler cannot leave the
 * dialog open behind a request.
 */
export function useConfirm() {
  const [pending, setPending] = useState(null)

  const dialog = (
    <ConfirmDialog
      open={!!pending}
      title={pending?.title}
      confirmLabel={pending?.confirmLabel}
      cancelLabel={pending?.cancelLabel}
      tone={pending?.tone}
      onCancel={() => setPending(null)}
      onConfirm={() => { const p = pending; setPending(null); p?.onConfirm?.() }}
    >
      {pending?.body}
    </ConfirmDialog>
  )

  return { ask: setPending, dialog }
}
