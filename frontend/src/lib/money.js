// Positive monetary inputs use half-up rounding, including decimal midpoint ties.
export function moneyRound(value, places = 2) {
  const scale = 10 ** places
  return Math.round((Number(value) + Number.EPSILON * Math.max(1, Math.abs(value))) * scale) / scale
}
