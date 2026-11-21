import { useState, useRef, useEffect, useId } from 'react'
import './SmartCell.css'

/**
 * SmartCell — Excel-style autocomplete input
 * 
 * Props:
 * - value: current value string
 * - options: array of { label, sublabel? } to suggest
 * - placeholder: input placeholder
 * - onChange: called when value changes (typing)
 * - onSelect: called when user picks an option { label, sublabel }
 * - onAddNew: called when user wants to add a new item (label string)
 * - addNewLabel: text for the "add new" option e.g. "Add as new vendor"
 * - readOnly: disable editing
 */
export default function SmartCell({
  value = '',
  options = [],
  placeholder = '',
  onChange,
  onSelect,
  onAddNew,
  addNewLabel = 'Add as new item',
  onManage,
  readOnly = false,
  className = '',
  label,
  id,
}) {
  const [open, setOpen]         = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef()
  const ddRef    = useRef()
  const cellRef  = useRef()
  const listId = useId()

  // Filter options based on current value
  const query = value.trim().toLowerCase()
  const filtered = options.filter(opt => {
    const text = `${opt.label} ${opt.sublabel || ''}`.toLowerCase()
    return text.includes(query)
  })

  // Check if exact match exists
  const exactMatch = options.find(
    opt => opt.label.toLowerCase() === value.toLowerCase()
  )

  // Show "Add new" only if user typed something and no exact match
  const showAddNew = onAddNew && value.trim().length > 0 && !exactMatch

  const totalItems = filtered.length + (showAddNew ? 1 : 0) + (onManage ? 1 : 0)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (cellRef.current && !cellRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (open) {document.getElementById(`${listId}-${activeIdx}`)?.scrollIntoView?.({ block: 'nearest' })}
  }, [open, activeIdx, listId])

  // Reset active index when options change
  useEffect(() => { setActiveIdx(0) }, [value])

  const handleKeyDown = (e) => {
    if (readOnly) {return}
    if (e.key === 'Tab') { setOpen(false); return }
    if (!open) {
      if (e.key === 'ArrowDown') { setOpen(true); return }
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, totalItems - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && totalItems > 0) {
      e.preventDefault()
      if (activeIdx < filtered.length) {
        handleSelect(filtered[activeIdx])
      } else if (showAddNew && activeIdx === filtered.length) {
        onAddNew(value.trim())
        setOpen(false)
      } else if (onManage) {
        onManage(); setOpen(false)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const handleSelect = (opt) => {
    if (readOnly) {return}
    onSelect && onSelect(opt)
    setOpen(false)
  }

  // Highlight matching part of text in bold
  const highlight = (text, query) => {
    if (!query) {return text}
    const idx = text.toLowerCase().indexOf(query.toLowerCase())
    if (idx === -1) {return text}
    return (
      <>
        {text.slice(0, idx)}
        <strong>{text.slice(idx, idx + query.length)}</strong>
        {text.slice(idx + query.length)}
      </>
    )
  }

  return (
    <div ref={cellRef} className={`sc-wrap ${className}`}>
      <span className="ec-sizer">{value || placeholder}</span>
      <input
        id={id}
        ref={inputRef}
        className="sc-input"
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        role="combobox"
        aria-label={label || placeholder || 'Select item'}
        aria-autocomplete="list"
        aria-expanded={open && !readOnly && totalItems > 0}
        aria-controls={open && totalItems > 0 ? listId : undefined}
        aria-activedescendant={open && totalItems > 0 ? `${listId}-${activeIdx}` : undefined}
        size={1}
        onChange={e => {
          onChange && onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => !readOnly && setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
      />

      {open && !readOnly && (totalItems > 0 || query) && (
        <div ref={ddRef} id={listId} role="listbox" className="sc-dropdown">

          {/* Hint */}
          {filtered.length > 0 && (
            <div className="sc-hint">
              ↑↓ navigate · Enter to select · Tab to move · Esc to close
            </div>
          )}

          {/* Options list */}
          {filtered.map((opt, i) => (
            <div
              key={i}
              id={`${listId}-${i}`} role="option" tabIndex={-1} aria-selected={i === activeIdx}
              className={`sc-option ${i === activeIdx ? 'sc-active' : ''}`}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={e => { e.preventDefault(); handleSelect(opt) }}
            >
              <span className="sc-option-label">
                {highlight(opt.label, value)}
              </span>
              {opt.sublabel && (
                <span className="sc-option-sub">{opt.sublabel}</span>
              )}
            </div>
          ))}

          {/* Add new option */}
          {totalItems === 0 && <div className="sc-hint" role="status">No matches. Try a SKU code, vendor code or product name.</div>}
          {showAddNew && (
            <div
              className={`sc-addnew ${activeIdx === filtered.length ? 'sc-active' : ''}`}
              id={`${listId}-${filtered.length}`} role="option" tabIndex={-1} aria-selected={activeIdx === filtered.length}
              onMouseEnter={() => setActiveIdx(filtered.length)}
              onMouseDown={e => { e.preventDefault(); onAddNew(value.trim()); setOpen(false) }}
            >
              <span className="sc-plus">+</span>
              {addNewLabel} "{value.trim()}"
            </div>
          )}
          {/* Manage link */}
          {onManage && (
            <button type="button" id={`${listId}-${totalItems - 1}`} role="option" aria-selected={activeIdx === totalItems - 1} className="sc-manage" onMouseDown={e => e.preventDefault()} onClick={() => { onManage(); setOpen(false) }}>
              ⚙ Manage categories →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
