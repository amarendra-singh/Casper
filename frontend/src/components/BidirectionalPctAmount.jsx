/**
 * BidirectionalPctAmount
 * ──────────────────────────────────────────────────────────────────────
 * Renders a bidirectional `% ↔ ₹` pair of cells in a table row.
 * Used for CR, Damage, Profit (and future: Tier, AD).
 *
 * Behaviour:
 *  • Edit % → ₹ auto-derives from anchor (handled by parent onUpd; we just
 *    clear the ₹ field and store the typed %).
 *  • Edit ₹ → % auto-derives (parent computes from ₹ ÷ anchor × 100).
 *  • Master stored value = whichever was last typed; the other is computed.
 *
 * The component is dumb about the math — it only:
 *  • Shows two inputs
 *  • On change, calls onUpd({ [pctKey]: x, [amtKey]: '' }) or vice-versa
 *  • Renders computed value as placeholder when input is empty
 *
 * Anchors live in the parent's compute() function; see logic.md §4.
 */
export default function BidirectionalPctAmount({
  pctKey,
  amtKey,
  pctValue,
  amtValue,
  pctComputed,
  amtComputed,
  onUpd,
  pctVisible = true,
  amtVisible = true,
  pctClassName = '',
  amtClassName = '',
  shadeClassName = '',
  size = 1,
}) {
  return (
    <>
      {pctVisible && (
        <td className={`ec ${pctClassName} ${shadeClassName}`}>
          <div className="ec-sizer-wrap">
            <span className="ec-sizer mono">{pctValue || pctComputed}</span>
            <input
              className="ec-input right mono"
              type="number"
              size={size}
              value={pctValue}
              placeholder={pctComputed}
              onChange={e => onUpd({ [pctKey]: e.target.value, [amtKey]: '' })}
              onBlur={e => {
                // Round to 2 decimals on blur — keeps stored value clean
                const v = parseFloat(e.target.value)
                if (Number.isFinite(v)) onUpd({ [pctKey]: String(+v.toFixed(2)), [amtKey]: '' })
              }}
            />
          </div>
        </td>
      )}
      {amtVisible && (
        <td className={`ec ${amtClassName} ${shadeClassName}`}>
          <div className="ec-sizer-wrap">
            <span className="ec-sizer mono">{amtValue || amtComputed}</span>
            <input
              className="ec-input right mono"
              type="number"
              size={size}
              value={amtValue}
              placeholder={amtComputed}
              onChange={e => onUpd({ [pctKey]: '', [amtKey]: e.target.value })}
              onBlur={e => {
                const v = parseFloat(e.target.value)
                if (Number.isFinite(v)) onUpd({ [pctKey]: '', [amtKey]: String(+v.toFixed(2)) })
              }}
            />
          </div>
        </td>
      )}
    </>
  )
}
