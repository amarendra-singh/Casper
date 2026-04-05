import { useState, useRef, useEffect } from 'react'
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
}) {
  const [open, setOpen]         = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef()
  const ddRef    = useRef()
  const cellRef  = useRef()

  // Filter options based on current value
  const filtered = options.filter(opt =>
    opt.label.toLowerCase().includes(value.toLowerCase()) ||
    (opt.sublabel || '').toLowerCase().includes(value.toLowerCase())
  )

  // Check if exact match exists
  const exactMatch = options.find(
    opt => opt.label.toLowerCase() === value.toLowerCase()
  )

  // Show "Add new" only if user typed something and no exact match
  const showAddNew = onAddNew && value.trim().length > 0 && !exactMatch

  const totalItems = filtered.length + (showAddNew ? 1 : 0)

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

  // Reset active index when options change
  useEffect(() => { setActiveIdx(0) }, [value])

  const handleKeyDown = (e) => {
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
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      if (activeIdx < filtered.length) {
        handleSelect(filtered[activeIdx])
      } else if (showAddNew) {
        onAddNew(value.trim())
        setOpen(false)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const handleSelect = (opt) => {
    onSelect && onSelect(opt)
    setOpen(false)
    inputRef.current?.blur()
  }

  // Highlight matching part of text in bold
  const highlight = (text, query) => {
    if (!query) return text
    const idx = text.toLowerCase().indexOf(query.toLowerCase())
    if (idx === -1) return text
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
      <input
        ref={inputRef}
        className="sc-input"
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={e => {
          onChange && onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />

      {open && totalItems > 0 && (
        <div ref={ddRef} className="sc-dropdown">

          {/* Hint */}
          {filtered.length > 0 && (
            <div className="sc-hint">
              ↑↓ navigate · Enter/Tab to select · Esc to close
            </div>
          )}

          {/* Options list */}
          {filtered.map((opt, i) => (
            <div
              key={i}
              className={`sc-option ${i === activeIdx ? 'sc-active' : ''}`}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={() => handleSelect(opt)}
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
          {showAddNew && (
            <div
              className={`sc-addnew ${activeIdx === filtered.length ? 'sc-active' : ''}`}
              onMouseEnter={() => setActiveIdx(filtered.length)}
              onMouseDown={() => { onAddNew(value.trim()); setOpen(false) }}
            >
              <span className="sc-plus">+</span>
              {addNewLabel} "{value.trim()}"
            </div>
          )}
          {/* Manage link */}
          {onManage && (
            <div className="sc-manage" onMouseDown={() => { onManage(); setOpen(false) }}>
              ⚙ Manage categories →
            </div>
          )}
        </div>
      )}
    </div>
  )
}