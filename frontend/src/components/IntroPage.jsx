import { useState } from 'react'
import './IntroPage.css'

/**
 * IntroPage — reusable in-app help/intro template.
 *
 * Structure (per section):
 *   1. WHAT — plain English, what this feature does
 *   2. MATH — formulas with worked example using realistic numbers
 *   3. TECHNICAL — collapsible details (file paths, API endpoints, edge cases)
 *
 * Usage:
 *   <IntroPage title="Profit & Loss" emoji="💰" tagline="...">
 *     <IntroSection title="What this does"> ... </IntroSection>
 *     <MathSection formula="..." explanation="..." example={{...}} />
 *     <TechSection items={[...]} />
 *   </IntroPage>
 */
export default function IntroPage({ title, emoji = '📖', tagline, children }) {
  return (
    <div className="intro-page">
      <div className="intro-header">
        {emoji && <span className="intro-emoji">{emoji}</span>}
        <div>
          <h1 className="intro-title">{title}</h1>
          {tagline && <p className="intro-tagline">{tagline}</p>}
        </div>
      </div>
      <div className="intro-body">
        {children}
      </div>
    </div>
  )
}

/** Plain-language section. */
export function IntroSection({ title, children }) {
  return (
    <section className="intro-section">
      <h2 className="intro-section-title">{title}</h2>
      <div className="intro-section-body">{children}</div>
    </section>
  )
}

/**
 * Math section — formula on top, explanation, worked example below.
 *
 * Props:
 *   title           — defaults to "The Math"
 *   formula         — single-line formula string (rendered in monospace)
 *   explanation     — JSX/string explaining in plain English
 *   example         — { title, inputs: [{label, value}], output: {label, value, valueClass}, breakdown?: string }
 *   variants        — optional array of { title, formula, explanation, example } for multi-formula sections
 */
export function MathSection({ title = 'The Math', formula, explanation, example, variants }) {
  return (
    <section className="intro-section intro-math-section">
      <h2 className="intro-section-title">{title}</h2>
      <div className="intro-section-body">
        {formula && <pre className="intro-formula">{formula}</pre>}
        {explanation && <div className="intro-explanation">{explanation}</div>}
        {example && <ExampleBlock {...example} />}
        {variants && variants.map((v, i) => (
          <div key={i} className="intro-variant">
            <h3 className="intro-variant-title">{v.title}</h3>
            {v.formula && <pre className="intro-formula">{v.formula}</pre>}
            {v.explanation && <div className="intro-explanation">{v.explanation}</div>}
            {v.example && <ExampleBlock {...v.example} />}
          </div>
        ))}
      </div>
    </section>
  )
}

function ExampleBlock({ title = 'Example', inputs = [], output, breakdown }) {
  return (
    <div className="intro-example">
      <div className="intro-example-title">{title}</div>
      <div className="intro-example-grid">
        {inputs.map((inp, i) => (
          <div key={i} className="intro-example-row">
            <span className="intro-example-label">{inp.label}</span>
            <span className="intro-example-value">{inp.value}</span>
          </div>
        ))}
        {breakdown && (
          <div className="intro-example-breakdown">{breakdown}</div>
        )}
        {output && (
          <div className="intro-example-row intro-example-output">
            <span className="intro-example-label"><strong>{output.label}</strong></span>
            <span className={`intro-example-value strong ${output.valueClass || ''}`}>{output.value}</span>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Technical section — collapsible accordion with key-value pairs.
 * Hidden by default so user-facing content stays clean.
 *
 * Props:
 *   items: [{ label, value, code? }]   — `code: true` renders the value as monospace
 */
export function TechSection({ items = [], title = 'Technical details (for developers)' }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="intro-section intro-tech-section">
      <button className="intro-tech-toggle" onClick={() => setOpen(o => !o)}>
        <span className="intro-tech-chev">{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {open && (
        <div className="intro-tech-body">
          {items.map((it, i) => (
            <div key={i} className="intro-tech-row">
              <span className="intro-tech-label">{it.label}</span>
              <span className={`intro-tech-value ${it.code ? 'mono' : ''}`}>{it.value}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * Tip / callout block.
 * variant: 'info' | 'warn' | 'success'
 */
export function Callout({ variant = 'info', children }) {
  const icon = variant === 'warn' ? '⚠️' : variant === 'success' ? '✓' : 'ℹ️'
  return (
    <div className={`intro-callout intro-callout-${variant}`}>
      <span className="intro-callout-icon">{icon}</span>
      <div>{children}</div>
    </div>
  )
}
