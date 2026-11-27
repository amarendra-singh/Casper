# Browser audit repair review — 2026-10-04

The independent browser/code audit and operator continuation were traced to the current source. This repair pass changes application code and adds regression tests. It preserves the pre-existing working tree and makes no writes to real financial records, company settings, credentials or permissions. No commit or deployment was performed.

## Principal changes

- Fraud rebuild helpers flush into their caller's transaction. Upload/replacement savepoints can now complete without closing the enclosing transaction. Cohort keys include the signal used in grouping.
- Hidden-SKU recovery preserves existing GST, metadata and explicit cost overrides; only supplied changes overwrite them. The form loads existing costs and displays GST. Already matched historical cost snapshots remain protected.
- Risk scores generate INVESTIGATE/WATCH work, with no automatic customer blocklist, repeat-offender claim, hardcoded order value or invented monetary recovery. Cohorts and imported customer identities are distinguished.
- Pricing target shortfalls remain useful planning variances, but are no longer represented as money owed. The legacy recoverable field is unavailable. Dashboard payout ratios use actual bank payout/GMV; return/RTO denominators use SKU observations, rather than return-only actor cohorts or gross-minus-net units.
- Overlapping report coverage is rejected in both route and service paths. Replacement requires owned, identical platform/date coverage. Existing ambiguous overlapping reports are retained for review, excluded from dashboard/operations/profitability/reconciliation aggregates, and disclosed by warnings. Direct report detail remains readable.
- Financial bridges disclose unclassified adjustments instead of inventing fee components. Consolidated statements now include uncosted-payout exclusions, costed payout, fulfillment and return costs.
- Paid/issued invoice details cannot be rewritten or deleted. Increasing payments on issued invoices and notes remain supported. Unpaid sent invoices can be voided, retaining their original values and transactional financial history. Generic documents no longer claim TAX INVOICE status.
- Financial configuration validates names, finite nonnegative money, bounded probabilities/fee rates, positive unit targets and numeric damage defaults. UI explains default-versus-override behavior without rewriting saved prices or historic snapshots.
- Platform risk has real queries, finite loading/error states and retry. SKU/temporal endpoints accept consolidated tenant scopes and ignore obsolete order observations. Viewers cannot resolve alerts or reprocess source reports.
- UTF-8 CSV input is explicitly decoded before workbook parsing. Supplier bill saves refresh the parent ledger; unconfirmed suggested matches cannot apply costs. Upload conflict timestamps designate UTC.

## Finding disposition

IDs refer to audit/browser-audit/REPORT_2026-10-04.md and OPERATOR_UX_REPORT_2026-10-04.md.

| Finding | Implemented behavior / qualification |
|---|---|
| F01 | Investigation queue replaces automatic blocking and unsupported recovery amounts; cohort identity explicitly disclosed. No sanctions/claims case-management system was invented. |
| F02 | Key matches state/reason/signal grouping; repeated rebuild under savepoint regression passes. ShopDeck ownership exclusion is retained. |
| F03 | Target shortfall is labelled a pricing variance, with no verified recoverable amount. Generic and saved settlement-gap alerts carry the same qualification. |
| F04 | Payout/GMV replaces false contribution-margin labels. Contribution remains available from the separate cost-aware statement engine. Marketplace comparison uses aligned report coverage and discloses the pre-product-cost basis. |
| F05 | New overlaps rejected, replacement scoped, legacy ambiguous aggregates excluded with warning. No live reports deleted or silently selected as winners. Concurrent multi-worker import certification remains outside this pass. |
| F06 | Platform/tier names, fees, rates and unit targets constrained; damage-setting and pricing override inputs validated. |
| F07 | List-aware scope filters repair SKU risk and related dashboard/temporal reads; visible errors replace false empty results. |
| F08 | Issued/paid financial document preservation and unpaid void workflow implemented. Generic INVOICE label replaces TAX INVOICE. Full GST issuance, credit-note/refund journals and legal compliance remain incomplete; seller address/GSTIN, HSN and supply/tax-split configuration must be designed before claiming those capabilities. |
| F09 | Platform risk queries supply overview and settlement props, with error/retry coverage. |
| F10 | Dashboard declares all uploaded periods; unsupported date/company/chart controls are disabled or removed. Channel chips are explicitly scoped to channel cards. Company switcher remains authoritative. A full date-range analytics feature was not added. Monthly chart is labelled by report starting month. |
| F11 | Overall return/RTO uses operations data; channel RTO comes from recorded RTO units. Combined SKU return/RTO/cancellation percentage is labelled loss rate. |
| F12 | Marketplace attribution follows PnlReport, independently of the pricing anchor. |
| F13 | Waterfall includes explicit unclassified bridge; consolidated cost exclusions/deductions render and aggregate. No external bank reconciliation is implied. |
| F14 | Zero-unit loss classification uses total monetary profit rather than unavailable per-unit profit. |
| F15 | Invalid combined/range probabilities hide results and display explanation; nonpositive break-even denominator returns unavailable, not zero. |
| F16 | Viewer/consolidated settings edits disabled; invoice writes guarded; owning company is identified. Modules are explicitly navigation preferences, with authorization enforced by company roles. They are not billed entitlements. |
| F17 | Optional dashboard failures, settings failures and risk-tab failures are visible. Module switches expose state. Notifications announce feedback, retain errors until dismissed, and avoid stale timers. |
| F18 | Defaults/override/materialization contract disclosed; no silent recalculation of existing or frozen records. |
| O19 | Full Meesho workbook import and replacement complete risk processing. Optional failures retain truthful warnings and expose a retry action. |
| O20 | Omitted tax/override/metadata preserved, including GST 0/5/18 regression cases. Existing inputs prefetched and GST editable. |
| O21 | Real workbook parser verified to retain UTF-8 CSV currency-header costs. |
| O22 | CR inputs start at actual zero; missing required values give feedback. |
| O23 | Supplier save refreshes ledger entries/totals; stale link/apply errors cleared. |
| O24 | Duplicate conflict response includes UTC timezone designation, allowing correct local rendering. |

## Verification

- Backend full suite: **367 passed** using `backend/env/Scripts/python.exe -m pytest tests -q -p no:cacheprovider` from backend.
- Frontend suite: **115 passed in 9 files**. Includes platform risk load/failure/retry and impossible calculator probabilities.
- Frontend lint: **0 errors, 0 tracked warnings**; production build passes.
- Backend configured Ruff checks pass; these are the repository's narrow configured rules, not comprehensive type certification.
- Real synthetic Meesho workbook import/replacement exercises parsing, order extraction, savepoints, risk rebuild and persistence in an in-memory, foreign-key-enforced database.
- UTF-8 CSV cost preservation checked against the installed XLSX parser: product 100, packaging 10, logistics 15, misc 5. Output: audit/csv-fix-verification.json.
- Regression coverage includes caller-owned rollback, cohort collision/idempotence, GST/override preservation, overlap isolation/exclusion, invalid settings, rate denominators, paid-invoice locks, unpaid void history, and viewer mutation rejection.
- Test logs: audit/backend-fixes-test-output.txt, audit/frontend-fixes-test-output.txt, audit/frontend-fixes-build-output.txt.

## Verification limits and business capabilities still absent

This chat's saved browser denial remains in effect. No browser workaround, live UI screenshot, native PDF print or fresh browser walkthrough was performed here. React interaction tests are DOM tests, not proof of the rendered running website. The independent reports' prior screenshots document the pre-repair behavior.

PostgreSQL, multi-worker import concurrency, deployment/load testing, formal accessibility and native print output remain unverified. A stock-movement ledger, double-entry accounting, durable claims/case workflow, tax credit-note/refund lifecycle and fully compliant GST issuance were recommendations for larger product features; they have not been represented as implemented by this repair pass.

Existing risk profiles can be rebuilt through the repaired upload/backfill path; this pass did not rewrite live history or reprocess real source files automatically. Full UI and financial production certification should not be inferred from the passing suites.
