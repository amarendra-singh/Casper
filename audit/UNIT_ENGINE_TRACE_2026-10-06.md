# Unit Economics engine trace

Read-only source audit, 2026-10-06. No formulas or business data changed. This extends the feature-flow audit; numerical parity across all engines is not yet verified.

## Execution paths

1. Grid base preview: frontend/src/pages/SKUs.jsx `compute` calculates base costs, markup and tax-inclusive target.
2. Grid platform preview: `computePlatform` replaces return-charge basis with the platform charge, includes advertising, then adds selected tier fee.
3. Grid persistence: entries.upsert_row resolves inputs, selects canonical base pricing, calls shared pricing.calculate_pricing and stores platform configs. It does not persist computePlatform's complete result for each channel.
4. Dedicated pricing: routes/skus.py create_pricing/update_pricing resolve defaults and store per-platform SkuPricing.
5. P&L: pnl._build_pricing_lookup finds SkuPricing using internal names or platform aliases; _build_sku_row copies that pricing record into frozen report cost fields.

## Verified source-level gaps

- Platform preview includes advertising and tier fees; shared backend calculate_pricing accepts neither. P&L snapshots use SkuPricing, not computePlatform. No parity contract connects displayed platform targets with stored P&L inputs. Whether a tier belongs in COGS, settlement target or actual marketplace deduction needs a defined financial meaning before changing formulas.
- Canonical base pricing can carry platform aliases for other platforms. Alias lookup returns the base pricing row; it does not recalculate that other platform's preview cost stack.
- Profit percentage is markup on breakeven. pnl._build_sku_row compares it directly with imported net_margin_pct. Different denominators can make the variance misleading; confirm parser semantics per platform. At cost 100 and target 120, markup is 20%, margin on revenue is 16.67%.
- JS base preview uses Math.round; Python uses round. At positive .5 ties their rounding differs (100.5 -> 101 in JS, 100 in Python). Platform preview also rounds to two decimals rather than the base preview's whole rupee.
- Two input resolvers remain: entries._resolve_pricing_inputs and pricing.resolve_pricing_inputs. The former back-computes percentage from a supplied absolute return/damage cost and does not round derived inputs in the same places as the latter.
- Return cost is platform return charge times return percentage; damage cost is purchase price times damage percentage. These are planning allowances, not evidence of actual order-level incurred cost.
- Bill match does not initialise pricing. Saving pricing does not automatically recover existing unmatched reports. Changing defaults does not recalculate all dependent pricing.

## Required acceptance checks

Use identical SKU, company, platform, inputs and overrides through grid preview, batch save, dedicated pricing, reload, P&L upload and rematch. Compare each component and target, not only final profit. Include zero vs omitted overrides, absolute-vs-percent costs, multiple platforms, tiers, advertising, fractional currency, .5 rounding, changed defaults, changed purchase costs, and frozen historical reports. Preserve tax treatment as an explicit product/accounting policy; this code inspection does not validate tax compliance.

## Proposed repair boundary

One server-side calculation contract should return named cost components and platform targets; frontend previews should follow the same contract. Keep product identity, acquisition cost, platform planning costs, actual marketplace deductions and historical snapshots distinct. Prevent double counting when actual fees already appear in settlement data. Add cross-path parity tests before migrating stored results.
