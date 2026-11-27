# Casper: settings, operations, analytics and UX audit

Date: 2026-10-04. Scope: the current working tree, including earlier repairs.

## Verdict and verification boundary

Casper has a reasonable foundation for an internal marketplace pricing and management-reporting tool. Its company-scoped models, route/service separation, migrations, cost snapshots, and pure calculation builders are strengths. The settings architecture needs explicit configuration semantics. Several dashboard conclusions are materially stronger than their underlying data supports. The application does **not** currently provide complete inventory, accounting, or dispute-management operations.

This is a source-code and synthetic-service audit, covering the primary route families and their main business flows. It is not a completed authenticated website walkthrough, an accessibility conformance certification, or a statutory-accounting certification. The browser tool rejected access to `http://127.0.0.1:5173` because a saved permission denies the origin, including after the user's approval replies. No alternate browser or indirect authenticated access was used to bypass that decision. Layout, responsive behavior, actual focus movement, print output, and rendered screens remain unverified in this pass.

The new executable evidence is `audit/business_logic_evidence.py`; its output is `audit/business_logic_evidence.json`. It calls actual schemas and service builders with synthetic inputs. The actor-key reproduction uses a recording session: duplicate keys are observed in service output; the resulting database unique-constraint failure is inferred, not demonstrated against the live database. No company data was edited. This pass adds audit artifacts only; the findings below remain open.

## Feature coverage and practical usefulness

| Area | Existing operation and useful purpose | Missing operation / assessment |
| --- | --- | --- |
| Login, registration, account | Password authentication, refresh rotation, session invalidation, company memberships, password change, per-process login throttling | No self-service password recovery, email verification, accepted invitation lifecycle or forced temporary-password change found. Throttling is process-local. Suitable for controlled internal use; incomplete for broadly exposed SaaS. |
| Companies and team | Create, rename, archive/restore, memberships, owner/admin/viewer roles and consolidated company scope | Team addition directly creates/adds accounts using an owner-supplied temporary password; it is not a recipient-accepted invitation. Distinguish user-level and company-level roles consistently in the interface. |
| Settings | Company modules, platform return assumptions, ad/profit defaults, fee tiers, company management and change history | Weak numeric/string validation, unclear default inheritance and refresh behavior, frontend-only module switches, write controls exposed to viewers, no impact preview. Useful configuration foundations, incomplete operating contract. |
| Products, categories, vendors | Product identity, costs, supplier metadata, classifications and marketplace aliases | Base costs are attached to the oldest active platform rather than a separate SKU cost record. This couples product economics to platform activation order. |
| Unit economics, pricing, calculator | Cost stack, return/damage assumptions, target profit, GST-rate arithmetic, fee-tier/ad scenarios | These are planning estimates. Display assumptions and distinguish markup on cost from sales margin and target payout from actual settlement. Settings changes need an explicit inheritance/recalculation policy. |
| Inventory | Reuses the SKU grid in catalog/cost mode | No stock-movement model, receipts, issues, reservations, warehouse balances or stocktaking flow found. This is a catalog view, not a stock-control system. The grid subtitle already says product catalog and costs; the navigation still says Inventory. |
| Settlement imports and report P&L | Marketplace parsers, exact-period duplicate detection, SKU matching, source files, frozen costs and processing warnings | Overlapping non-identical report periods can still be accepted and summed. Upload processing runs inside the request. Period selection and completeness must be consistent across summaries. Useful report analysis, not bank-transaction reconciliation. |
| Consolidated business P&L | Backend selects an aligned month, identifies excluded platforms, uses frozen costs and prevents uncosted payout becoming profit | Stronger than the main dashboard. Month identity alone does not prove equal day coverage within a month; expose actual report coverage. The frontend comment about latest report per platform is outdated relative to the aligned-period backend. |
| Procurement / bill discrepancies | Stores supplier bills, supplier-reference identity, ledger link, remembered aliases, explicit pack size, confirmed cost application | A suggested match cannot apply money automatically, which is a good control. No purchase-order/receipt/invoice three-way matching or payment-allocation workflow found. Useful supplier-cost control, partial procurement. |
| Billing | Invoice numbering, line totals, payment balance, aging, export and print preview | Sent/paid invoices can be edited or deleted; no credit-note correction lifecycle found. Printed TAX INVOICE lacks supplier GSTIN/address, supply-state tax breakdown and line HSN fields. Not ready to present as a complete GST invoicing operation. |
| Ledger | Company-scoped income/expense lines, categories, counterparty/reference fields and supplier-bill posting | No debit/credit journal, chart of accounts, trial balance, period close or bank matching found. Useful cash/expense register; incomplete accounting ledger. |
| Dashboard / SKU analytics | Actual report aggregates, monthly series, matched-SKU profitability, channel comparison | Period and metric labels disagree with queries, some failures become empty data, company labels are hardcoded, channel filtering is partial. Useful data underneath, unreliable summary presentation. |
| Fraud / return intelligence | Rule-based return/state/reason signals and imported ShopDeck customer records | State/reason cohorts are mixed with real customers. Block/repeat-offender recommendations and recoverable amounts are unsupported for cohorts. Useful investigation prioritization after relabelling, not validated customer fraud adjudication. |
| Action queue and exports | Prioritized rows, suggested evidence templates, blocklist CSV | No durable assignee, due date, claim submission, evidence attachment, case status or recovered-payment outcome found. This is a recommendation list, not a closed operational workflow. |

## Priority findings

P1 means material financial interpretation, incorrect targeting, or failed processing. P2 means an important workflow, reliability or UX defect. P3 means maintainability or capability improvement. These are audit priorities, not a claim of independently verified exploit severity.

### A01 — P1: cohort analytics recommend blocking individual customers

`backend/app/services/fraud.py:733` builds profiles grouped by state, return reason and signal type (`:769`), filtered to events with a return reason. These are return cohorts, not identified customers. `backend/app/services/action_pipeline.py:51` maps CRITICAL profiles to BLOCK; `:89` assigns repeat-offender flags from cohort counts. `frontend/src/pages/Dashboard.jsx:147` tells users to block repeat refusers and exports the resulting cohort hashes.

Observed with synthetic service input: a critical state/reason cohort produces BLOCK. Keep cohorts in a separately named return-investigation view. Only customer-identifiable records should enter customer actions; require supporting order evidence and human review. Track false positives and reviewed outcomes before treating scores as decision rules. ShopDeck customer identities must remain distinguishable from derived cohorts.

### A02 — P1: actor grouping and unique identity disagree

Grouping includes `fraud_signal_type`, but `backend/app/services/fraud.py:807` hashes only state and reason. `backend/app/models/fraud.py:231` requires unique company/actor keys. If one state/reason has two signal groups, the real service constructs two rows with the same unique key. The recording-session reproduction produced identical keys. Real insertion would conflict with the unique constraint; P&L's optional fraud-processing handler can then report incomplete processing (`backend/app/services/pnl.py:1050`).

Make grouping and identity use exactly the same dimensions, while addressing A01's cohort semantics. Add a disposable-database regression with both signal values, confirm refresh completes and confirm ShopDeck customers survive the rebuild.

### A03 — P1: target-price shortfalls are labelled recoverable settlement debts

`backend/app/services/pricing.py:101` builds a desired payout from costs, target profit and GST. P&L captures `sp.bank_settlement` as expected settlement (`backend/app/services/pnl.py:938`). `backend/app/services/reconciliation.py:64` compares actual payouts with that target and sums deficits as `recoverable`.

Observed: target ₹120/unit, ten units and ₹1,000 actual payout produce ₹200 labelled recoverable, with no contractual receivable or settlement transaction evidence. This is a target payout shortfall. Actual reconciliation needs order-linked expected contractual proceeds, documented fees/adjustments, payout identifiers and bank transactions. Display target variance separately from proven payable differences.

### A04 — P1: recovery estimates invent order values

`backend/app/services/action_pipeline.py:26` sets average order value to ₹600; `:88` multiplies every returned order by it and `:109` adds both BLOCK and DISPUTE impacts to estimated recovery. Five returned orders produce ₹3,000 without any monetary source data. Blocking a customer does not recover historic money.

Use actual order amounts and eligible claim amounts when available. Otherwise show a count and explicitly unavailable monetary exposure. Keep exposure, filed claims and cash recovered as separate measures. Claim templates also need marketplace-specific applicability rather than a shared default claim name.

### A05 — P1: contribution margin is calculated from platform earnings before SKU costs

`frontend/src/pages/Dashboard.jsx:314` divides report `total_net_earnings` by gross sales and calls it Contribution margin (`:409`). Some parsers set net earnings equal to bank settlement (`backend/app/services/pnl.py:388`, `:653`); the measure does not deduct product costs. A high payout-to-GMV ratio therefore appears as high contribution margin even when products lose money.

Use the existing costed statement engine's contribution and denominator, with matched-cost coverage shown. Label payout as net settlement rather than net revenue. Do not equate platform export earnings with business profit.

### A06 — P1: accepted overlapping reports inflate lifetime totals

`backend/app/services/pnl.py:782` rejects only identical company/platform/start/end periods. `:1119` sums every report. A January report and a January-to-February cumulative report can both be accepted; the January proceeds then appear twice in dashboard totals. Current-order deduplication does not remove duplicated report monetary aggregates.

Define report identity and coverage: reject overlap for additive summaries, or select canonical period reports and explicitly exclude overlaps. If the underlying data supports incremental settlement events, aggregate those with source identifiers instead. Prove the rule with overlapping periods, replacements and legitimate adjustments.

### A07 — P2: fee waterfall does not always balance

`backend/app/services/operations.py:73` takes absolute values of fee components, drops a negative Other balance (`:82`) and independently appends settlement. Observed: ₹1,000 GMV, ₹150 identified fee, ₹100 total expense and ₹900 settlement display a ₹850 bridge ending at ₹900. Credits or reversals can cause this scenario.

Normalize parser signs explicitly, retain adjustment/credit lines and reconcile the bridge to its stated endpoint. Reuse an agreed accounting definition from the existing statement builder rather than maintaining conflicting waterfall logic. A balancing adjustment must be visibly unexplained when its source is unknown.

### A08 — P2: dashboard periods and filters are misleading

The dashboard query has no date restriction (`backend/app/services/pnl.py:1124`), yet revenue and page scope say last 30d (`frontend/src/pages/Dashboard.jsx:407`, `:560`). Monthly data is headed Weekly (`:828`). `selChan` filters the channel cards (`:679`) while global KPIs, other analytics and charts retain consolidated data.

Either label the actual lifetime/monthly scope or introduce one shared company/platform/date filter applied to every relevant query. Clearly identify a local channel-card filter if that is the intended behavior. Show source coverage and last successful refresh.

### A09 — P2: return-rate denominator excludes ordinary orders; RTO KPI ignores available data

The main dashboard sums actor counts (`frontend/src/pages/Dashboard.jsx:399`). Derived profiles include only events with non-null return reasons (`backend/app/services/fraud.py:765`). That is not the full order population and can dramatically inflate return rate; imported customer populations may also differ in coverage. The main RTO tile is permanently empty (`Dashboard.jsx:411`) while operations already computes RTO from report units.

Use one authoritative, deduplicated order/unit population per period and disclose whether the rate is order-based or unit-based. Feed the RTO card from that population. Cohort counts should describe investigation groups only.

### A10 — P2: marketplace attribution follows base pricing rather than the report

`backend/app/services/reconciliation.py:142` and `backend/app/services/profitability.py:149` join Platform through `SkuPricing.platform_id`. P&L matching supports aliases linked to a shared pricing row (`backend/app/services/pnl.py:852`). Consequently an alias report may be attributed to its pricing anchor platform instead of the report's marketplace.

Join platform identity through PnlReport. Keep source marketplace and cost-model provenance as separate fields. Verify with a SKU priced on one platform and aliased to another.

### S01 — P2: settings accept invalid financial configuration

`backend/app/schemas/platform.py:5` and `:27` use unconstrained names/numbers. Observed acceptance: empty names, negative CR charge, 150% CR rate, negative ad rate, zero monthly target and negative tier fee. `backend/app/routes/global_settings.py:60` stores arbitrary strings; `backend/app/services/entries.py:49` later converts damage_percent using float(), so malformed settings can break pricing operations.

Validate finite values, business-specific ranges, trimmed names and positive unit targets on the server. Percentages need field-specific policy: a return probability differs from a permissible profit markup. Define a small typed registry for existing global keys rather than accepting arbitrary text as numeric configuration.

### S02 — P2: changing defaults has no explicit recalculation contract

`backend/app/routes/platforms.py:114` updates and commits Platform fields without revisiting materialized SkuPricing outputs. Global-setting writes likewise do not propagate. The UI simply announces Platform updated (`frontend/src/pages/Settings.jsx:462`). Existing rows may intentionally freeze overrides, but the interface gives no explanation of which rows inherit a changed default.

Choose and display one policy: new entries only, or apply to current rows that inherit this default. Preserve explicit overrides and historical report snapshots. Show affected-row count and before/after preview for an apply-current operation; record the effect in existing financial history. Avoid silently rewriting closed-period P&L.

### S03 — P2: module disablement is a UI preference, not an API rule

`frontend/src/App.jsx:76` guards frontend routes. CompanyModule is read/written in company services; no matching module dependency was found in the backend module routes/core. Existing company/role authorization still applies. The defect is a discrepancy between the owner's module switch and backend availability, not evidence of cross-company access.

Define whether switches are navigation preferences or operational entitlements. Label preferences accordingly; enforce entitlements on every backend request if disabling is meant to restrict feature use. This follows [OWASP's request-level authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

### U01 — P2: unavailable analytics masquerade as empty business data

`frontend/src/pages/Dashboard.jsx:281` converts several failed requests to empty lists/null. It can therefore display no actors or insights when their services failed. Settings loading (`frontend/src/pages/Settings.jsx:457`) has finally() without a catch and can show an empty-platform state after failure.

Give each panel loading, ready, empty and unavailable states with retry. Do not render a failed investigation feed as evidence of no risk. Show report processing warnings alongside dependent analytics.

### U02 — P2: viewer and consolidated settings show unusable write controls

PlatformCard and TierRow do not receive company write capability (`frontend/src/pages/Settings.jsx:158`, `:243`, `:550`), unlike owner-gated module controls. Platform writes require owner/admin on the server (`backend/app/routes/platforms.py:101`). Viewers can enter edit flows that end in 403; consolidated mode has no single company for these writes.

Derive a shared company capability and scope state. Render values read-only for viewers; require a selected company for configuration writes and identify the company on consolidated platform cards. Keep server role checks authoritative.

### U03 — P2: company identity and zero-value presentation are inconsistent

SKU dashboard rows hardcode company Shringar and category Jewellery (`frontend/src/pages/Dashboard.jsx:350`). Consolidated multi-company data is therefore mislabelled. `backend/app/routes/dashboard.py:72` treats a valid zero margin as unavailable, and zero return/RTO rates have upload prompts even with a known denominator (`:93`, `:103`).

Carry actual company/category identity from the API. Treat None/unknown separately from numeric zero. Ensure zero-loss and break-even datasets display successful observed results.

### U04 — P2: settings state and feedback are not exposed accessibly

Module buttons have an action label but no switch/pressed state (`frontend/src/pages/Settings.jsx:51`). Toasts are ordinary divs (`:153`) and disappear after three seconds (`:453`). Keyboard support and labels added in prior repairs do not establish full accessible state/feedback behavior.

Use semantic switch or pressed-button state and announce success/error through appropriate live regions; leave financial errors visible until resolved. These recommendations follow W3C [Name, Role, Value](https://www.w3.org/WAI/WCAG21/Understanding/name-role-value) and [status message techniques](https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA22). Test with real keyboard and assistive technology when browser access is available.

### O01 — P1 for external tax-invoice use: billing lacks invoice document and correction controls

`frontend/src/pages/Billing.jsx:323` prints TAX INVOICE, but Company has no supplier tax/address profile (`backend/app/models/company.py:27`), InvoiceLine has no HSN/tax breakdown (`backend/app/models/billing.py:74`), and the print template lacks those details. `backend/app/routes/billing.py:263` permits general mutation of issued records and `:302` permits deletion regardless of status.

For registered-supplier tax invoices, compare applicable fields against current [CBIC Rule 46](https://taxinformation.cbic.gov.in/content-page/explore-rules/1000136/1000001). Add supplier/recipient/supply details and appropriate tax components, or present the current output as an internal billing document. Lock finalized documents and implement traced correction/cancellation/payment events. This identifies implementation gaps; it is not a legal compliance opinion for a particular supplier.

### O02 — P3: deployment-scale authentication and import processing need operating controls

Login rate limiting lives in a process dictionary (`backend/app/routes/auth.py:31`). It resets on restart and is independent in each worker. Imports read/parse files and recompute analytics synchronously within their request, despite upload size checks (`backend/app/routes/pnl.py:59`, `:671`).

Keep the simple architecture for current internal scale. Before multi-worker/public deployment, use a shared bounded rate limiter with documented proxy-IP handling, and measure import latency/memory before introducing a persistent job queue. Add recovery/invitation flows only when the intended deployment requires them. Verify backups by restore and test the actual PostgreSQL deployment; prior SQLite tests are not proof of PostgreSQL operation.

## Recommended settings architecture

Retain the modular monolith and existing services. A microservice rewrite would add cost without solving these defects.

1. Separate company/team management, module preferences, financial defaults, marketplace fees and history into clear settings sections. Keep dangerous company actions visually distinct from everyday financial configuration.
2. Define field types, units, allowed ranges, default source and who may edit each existing setting. Keep company scope explicit. Avoid a speculative generic settings framework.
3. Store or expose the distinction between inherited inputs and explicit overrides. A resolved pricing view should show both the value and its source.
4. Separate platform-independent SKU costs from platform-specific return/fee/ad assumptions. Migrate only after existing semantics and historical snapshots are covered by regression tests. As a smaller interim improvement, configure an explicit anchor rather than selecting the lowest platform ID.
5. Preview financial impact before applying changes to current entries, and preserve report snapshots. Version settings only where reproducing financial calculations requires it; the current audit history is valuable but does not itself define effective dates.
6. Use shared capabilities and honest request status in the frontend. Backend validation, scope and entitlements remain authoritative.

## Analytics acceptance criteria

Analytics becomes reliably useful when every monetary KPI has a source, period, scope, unit, denominator and completeness indicator. A reader must distinguish imported facts, model assumptions, derived variances and human-reviewed decisions.

Useful today, subject to coverage: settlement summaries, uploaded-report fee/return breakdowns, costed SKU profitability and aligned consolidated P&L. Useful after terminology and population fixes: return/state/reason investigation priorities. Unsupported today: treating a state cohort as a person to block, ₹600-per-return recovery forecasts, and target-profit shortfalls as recoverable platform debt.

Implement A01–A06 and O01 before relying on these outputs for customer blocking, financial claims or external tax documents. Then fix attribution, filters, rate populations, configuration behavior and error states. After browser access is actually enabled, run a real walkthrough as owner/admin/viewer across one-company and consolidated scopes, failed-load states, non-identical overlapping imports, zero-loss data, keyboard flows, narrow screens and invoice printing. Use a throwaway company for all financial mutations.

## Code standards assessment

The project benefits from migrations, centralized tenant checks, existing confirmation/search components and extracted calculation services. Earlier clean lint/test results do not prove business definitions correct; the new service reproductions illustrate that distinction. Large page files mix acquisition, transformation and presentation, while analytics definitions are duplicated across Dashboard, operations, metrics, profitability and P&L statements.

Improve these surgically: establish one authoritative calculation for each KPI, reuse existing services/components, remove misleading stale comments when touching affected code, and add tests for financial invariants and actual failure modes. Separate page subcomponents when changing them, rather than undertaking cosmetic repository-wide rewrites. Monetary storage currently uses Float; an exact decimal/minor-unit migration is a longer-term accounting design improvement that requires reconciliation and migration verification, not a casual schema edit.

## Reproduction command

From the project root in PowerShell:

```powershell
backend/env/Scripts/python.exe audit/business_logic_evidence.py
```

Observed output: invalid platform/tier payloads accepted; ₹50 waterfall imbalance; ₹200 target gap labelled recoverable; cohort recommended BLOCK; ₹3,000 recovery without order values; duplicate actor keys across two signal groups. These are synthetic reproductions of current service behavior, not measurements of the company's losses.
