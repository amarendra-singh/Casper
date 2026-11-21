# Product catalogue and product profiles — implementation plan

Date: 9 October 2026. The first implementation is now in the codebase.

## Implemented and verified

- Added company-scoped Catalogue and SKU profile routes, searchable/paginated desktop table and mobile cards, authenticated image gallery, approved cost provenance, platform return allowance, linked supplier lines, report rows and historical performance.
- Added explicit shared physical-item mapping and append-only opening/receipt/dispatch/return/damage/adjustment/reversal movements. No supplier bill or marketplace report automatically changes stock.
- Added effective-dated cost approval from a confirmed bill or documented manual source. Applying cost requires a preview token, updates all linked SKU/platform pricing, and records a reversible financial-history change. Frozen report snapshots remain unchanged.
- Added source navigation from Unit Economics and costed P&L rows to the product profile. Kept the old Inventory URL as a redirect.
- Verified with a fresh migration, 415 backend tests, 135 frontend tests, lint/build, and a Tabbit walkthrough on a disposable company including search, reload, shared P6 stock, dispatch/reversal, manual cost, image upload and 390px layout. Backed up the local database before applying the migration.

Remaining extensions: product-level fraud/risk and invoice links need trustworthy SKU keys in those sources; partially overlapping report periods are flagged rather than deduplicated across different windows; multi-location/reservation stock is intentionally outside this first physical-stock model. Product media requires a persistent volume in deployment.

## Decision and outcome

The user confirmed that P1/P2/P6 variants draw from **one shared physical stock balance**. A conversion such as P6 = six base units must be saved explicitly for each SKU; the SKU code is never parsed to guess a pack size.

The Product section will have a dedicated **Catalogue** table and a route for each SKU, `/product/catalogue/:skuId`. Unit Economics remains the spreadsheet-style cost editor. The current “Inventory” page is only another view of that editor and has no physical stock model; replace that misleading view with the Catalogue and a clearly named Stock view once movements exist. Keep `/product/inventory` as a redirect or compatibility route so bookmarks survive.

## Existing sources and gaps

| Need | Existing source | Gap or rule |
| --- | --- | --- |
| Product identity | `Sku` (`id`, company, our SKU, vendor SKU, vendor, category, series, description, active) | No product title, images or variant-to-physical-stock mapping. The stable key is `Sku.id`, scoped by company. |
| Purchase cost | `SkuPricing.price` per platform; confirmed `PurchaseBillLine.unit_cost` with explicit pack conversion | There is no authoritative product-level current cost. Different platform prices can disagree. Historical P&L snapshots must stay frozen. |
| Expected customer-return cost | `SkuPricing.cr_cost`, `cr_percentage` per platform | This is an expected allowance, not a measured return expense. Show platform and calculation basis. |
| Observed sales, returns and profit | `PnlSkuRow` → `SkuPricing` → `Sku` when costed; confirmed `MarketplaceSkuAlias` → `Sku` when identity is known but cost is missing; report/platform/date and frozen cost snapshots | Count identity-linked units/returns even if cost is missing. Profit includes only costed rows. Expose both coverage counts and avoid double-counting replaced reports. |
| Return/RTO risk | `SkuRiskScore`, `OrderEvent` | These are risk/operational observations, not stock receipts or guaranteed return costs. Show source period and matching coverage. |
| Marketplace identity | `MarketplaceSkuAlias` → `Sku` | Display per-channel names and link status; reuse the existing matcher, never create a second alias system. |
| Stock | None | Bills record liabilities and costs, while settlement rows record marketplace outcomes. Neither proves physical receipt, dispatch or resaleable return. Build an auditable stock movement ledger. |

## Catalogue table

One row per sellable SKU, with a thumbnail or “No image” placeholder, product name, our SKU, vendor SKU, vendor, category, variant/pack quantity, **current approved purchase cost per sellable SKU**, stock shown as **on-hand pack equivalent**, expected customer-return cost for the selected platform, and status. The cost cell includes source/date and flags missing or conflicting legacy cost. The stock cell shows both pack equivalent and shared base-unit pool; a tooltip explains that pack equivalents across variants cannot be added together.

Provide search across our SKU, vendor SKU, product name, vendor, and confirmed marketplace names; filters for company, category, vendor, active state, missing image/cost, stock state and platform; server pagination and sorting. Keep the table compact and navigable by keyboard. Clicking a row opens the profile. On mobile, render concise product cards with the same status and primary actions. The platform selector controls platform-specific return allowance; do not silently choose one platform. A date selector controls observed performance, not current cost or stock.

## Product profile

- **Overview:** primary image and gallery, name, identifiers, vendor/category/HSN, description, active state, shared stock-item link, explicit units-per-SKU, and edit history.
- **Cost and pricing:** approved base-unit purchase cost, derived cost for this SKU's pack, source bill/manual record and effective date; each platform's live pricing, packaging/logistics, expected customer-return allowance, damage allowance, breakeven and target. Show conflicts rather than silently replacing a platform value. Link to Unit Economics/Pricing.
- **Stock:** shared base-unit on-hand balance, this SKU's on-hand pack equivalent (`floor(base units / units per SKU)`), recent movements, and links to linked variants. Do not label the balance “available to sell” until reservations are tracked. Show opening balance and adjustments with actor/reason.
- **Sales and returns:** date- and platform-filtered gross/net units, customer returns, RTOs, observed reverse-shipping charges where present, payout, frozen cost, profit and return on cost. Confirmed product identity can contribute units and returns before pricing exists; those rows stay out of profit until cost is known. Show a “data coverage” line for unmatched rows, missing costs and unavailable fields. Link to source reports and return/fraud views.
- **Connections:** supplier bills and confirmed item aliases, marketplace SKU names, related invoices/ledger entries only when actually SKU-linked, and financial/change history. Every link should navigate back to its source with the product context preserved.

No product profile number is recomputed independently in React; the backend returns labelled totals, units, scope, period and provenance. “Expected customer-return cost” and “observed return charges” remain separate.

## Data and API work, in order

1. **Product and media.** Add a display name to `Sku` and a company-scoped `SkuImage` table (`sku_id`, object key, primary flag, order, alt text, uploader/timestamps) through Alembic. Store image files outside the database, with private ownership checks, content/type/size validation, generated thumbnails, and deletion/reordering. Use local storage in development and a persistent object store in deployment. A SKU may have no image.
2. **Shared physical item.** Add `StockItem` (company, base unit) and `SkuStockMapping` (`sku_id`, `stock_item_id`, positive explicit base units per sellable SKU). P1/P2/P6 can map to one item at 1/2/6 units. Require review before linking existing SKUs; never infer this relationship from names. One item may have multiple sellable SKU profiles.
3. **Current cost.** Add effective-dated, approved cost records at the physical base-unit level with source (`PurchaseBillLine` or manual), currency, pack conversion and actor. For migration, compare existing platform `SkuPricing.price / units_per_sku`; auto-seed only unambiguous values and put conflicts in a review queue. A confirmed bill line can propose a new cost, but does not silently overwrite pricing. An approved cost change produces a preview of affected SKU variants/platforms; applying it updates active pricing through the existing pricing service and history/undo mechanism. Frozen report costs remain unchanged.
4. **Stock movements.** Add append-only, company-scoped base-unit movements: opening balance, goods receipt, dispatch, resaleable return, damage, adjustment and reversal. Record source identity/idempotency key, date, actor and reason. A supplier bill can be linked to a goods receipt, but bill upload alone does not increase stock. A settlement report alone does not decrease stock. Returns increase saleable stock only after inspection. Corrections post compensating movements rather than overwriting history. Start with one stock location; extend to multiple locations only when operations need it.
5. **Read models.** Add paginated `GET /catalogue` and `GET /catalogue/{skuId}` projections/services. Batch joins/aggregates by company and SKU to avoid one query per card. Resolve product identity through the existing marketplace alias service independently of cost, then reuse P&L and pricing calculations for costed rows. Include `as_of`, source, platform, period, unit, and missing-data flags. Cache only if a measured performance need appears; invalidate after SKU, cost, media, stock, alias or report changes.
6. **UI and navigation.** Add Catalogue route/tab/sidebar/search entry, dedicated table/cards and profile page. Preserve company scope and viewer read-only behavior. Use existing dialogs and searchable inputs for edits; do not embed another large autosave grid. Add links from Unit Economics, Pricing, vendor bills, and P&L SKU rows to the same profile, with reverse links from the profile.

## Invariants and acceptance checks

- No SKU/image/cost/stock/report from another company appears, including direct URL and media requests; All Companies remains read-only and clearly identifies each owner.
- A missing image, cost, stock mapping or report shows an explicit empty/unknown state, never zero. A single SKU has one primary image; a stock movement cannot be duplicated by retrying an import.
- If a shared item has 120 base units, P1/P2/P6 profiles show 120/60/20 on-hand pack equivalents respectively. These are alternative views of the same 120 units, not 200 independent units. A sale of one P6 posts −6 base units; a resaleable return posts +6 only after inspection.
- A ₹90 supplier box of six becomes ₹15 per base unit only when the six-unit conversion is explicitly confirmed. Changing current cost leaves historical frozen report profit unchanged; after an approved pricing refresh, future calculations use the new cost.
- Catalogue/P&L metrics agree for the same company, platform, report set and date range; uncovered rows and missing costs are counted and visible. Expected return allowance is never presented as actual return spending.
- Browser verification covers table search/filter/pagination, image upload and missing-image state, profile deep link/reload, company isolation, cost preview/undo, stock receipt/sale/return/reversal, and navigation to/from bills, pricing and reports at desktop and mobile widths.

The implementation should proceed as small reviewed slices: identity/media and read-only profile first; explicit shared-stock mapping and movement ledger second; approved cost integration third; performance/return rollups and cross-feature links fourth. Do not publish a numeric stock column before movement history and opening balances are available.
