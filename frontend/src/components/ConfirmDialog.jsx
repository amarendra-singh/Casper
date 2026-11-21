import { useEffect, useRef, useState, useId } from 'react'
import { createPortal } from 'react-dom'
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
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default', // 'default' | 'danger'
  onConfirm,
  onCancel,
  confirmDisabled = false,
  dialogRole = 'alertdialog',
  className = '',
  hideCancel = false,
}) {
  const confirmRef = useRef(null)
  const cancelRef = useRef(null)
  const boxRef = useRef(null)
  const descriptionId = useId()
  const callbacks = useRef({ onCancel })
  callbacks.current = { onCancel }

  useEffect(() => {
    if (!open) {return}
    const previousFocus = document.activeElement
    const background = [...document.body.children].filter(el => !el.contains(boxRef.current))
    const priorInert = background.map(el => el.inert)
    background.forEach(el => {
      el.inert = true
    })
    const firstField =
      dialogRole === 'dialog'
        ? boxRef.current?.querySelector(
            'input:not(:disabled):not([readonly]), select:not(:disabled), textarea:not(:disabled)',
          )
        : null
    ;(firstField || (tone === 'danger' ? cancelRef : confirmRef).current)?.focus()
    const onKey = e => {
      if (e.key === 'Escape') {
        e.preventDefault()
        callbacks.current.onCancel?.()
      }
      if (e.key === 'Tab') {
        const buttons = [
          ...boxRef.current.querySelectorAll(
            'button:not(:disabled), [href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          ),
        ]
        const first = buttons[0],
          last = buttons.at(-1)
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      background.forEach((el, i) => {
        el.inert = priorInert[i]
      })
      if (previousFocus?.isConnected) {previousFocus.focus()}
    }
  }, [open, tone, dialogRole])

  if (!open) {return null}

  return createPortal(
    <div className="cd-overlay" role="presentation" onMouseDown={e => {
      if (e.target === e.currentTarget) { onCancel() }
    }}>
      <div
        ref={boxRef}
        className={`cd-box ${className}`}
        role={dialogRole}
        aria-modal="true"
        aria-label={title}
        aria-describedby={descriptionId}
      >
        <div className="cd-title">{title}</div>
        <div id={descriptionId} className="cd-body">
          {children}
        </div>
        <div className="cd-actions">
          {!hideCancel && (
            <button ref={cancelRef} className="cd-btn cd-cancel" onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            className={`cd-btn cd-confirm${tone === 'danger' ? ' danger' : ''}`}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
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
      onConfirm={() => {
        const p = pending
        setPending(null)
        p?.onConfirm?.()
      }}
    >
      {pending?.body}
    </ConfirmDialog>
  )

  return { ask: setPending, dialog }
}
