/**
 * Small monochrome stroke glyphs for the P&L report tabs.
 * Replaces the old emoji icons (📦 ↩ ✕ ✓ ☠️ ⚠️ 🔍 📉 …) so the report area
 * reads as a designed system, not AI-slop. Inherit color via currentColor;
 * size via the `s` prop (default 18).
 */
function G({ s = 18, children }) {
  return (
    <svg viewBox="0 0 24 24" width={s} height={s} fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

export const Box       = (p) => <G {...p}><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></G>
export const Undo      = (p) => <G {...p}><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10H8"/></G>
export const XMark     = (p) => <G {...p}><path d="M6 6l12 12M18 6 6 18"/></G>
export const Check     = (p) => <G {...p}><path d="M20 6 9 17l-5-5"/></G>
export const Cash      = (p) => <G {...p}><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></G>
export const Card      = (p) => <G {...p}><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></G>
export const Ban       = (p) => <G {...p}><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></G>
export const Warn      = (p) => <G {...p}><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></G>
export const Search    = (p) => <G {...p}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></G>
export const TrendDown = (p) => <G {...p}><path d="M3 7l6 6 4-4 8 8"/><path d="M21 17v-6h-6"/></G>
