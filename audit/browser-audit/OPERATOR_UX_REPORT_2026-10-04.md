# Casper operator walkthrough and UX assessment — 2026-10-04

This continuation adds real browser write-flow verification to the earlier read-only audit. It supersedes that report's registration/import/billing/supplier/expense coverage limitations **only for the disposable flows listed below**. It does not establish that every operation or every marketplace file format works.

## Isolation and execution

Used the installed Tabbit CLI in browser-owned task **Casper operator walkthrough**, pinned to instance `348CCBF67DBABAFA`. Actual browser inputs, file selection, clicks and keyboard navigation were used; success was checked through reloads, API receipts, native downloaded files and a read-only database evidence snapshot. No application code was changed or deployment performed.

Separate frontend `http://localhost:5174/`, backend `http://127.0.0.1:8766/`. Database: `C:\WorkStation\Projects\Python\Casper\audit\browser-audit\operator\operator.sqlite`. Uploads and application logs remained under this disposable audit environment. Schema was created through the existing Alembic migration chain, not create_all. The original database and running-service ports were not used for writes. The audit helpers override database/upload/environment settings and use a separate Vite configuration without editing the application's configuration.

New synthetic account `operator-audit@example.com` and companies `Disposable UX Audit` / `Disposable Secondary Renamed`. No emails/invitations were sent, no existing credentials changed and no membership permissions granted. Self-service creation creates ownership of the new disposable company as designed. Password changes and member grants were excluded under the original user constraint. Test credentials in helper files are disposable only.

## Completed operator journeys

| Journey | Browser action and verification | Outcome / difficulty |
|---|---|---|
| Registration | Filled form, submitted, navigated and reloaded authenticated session | Works. Reserved .test email rejected422 with generic “Please check your details”; changing to example.com allowed signup. Generic validation does not identify the field. |
| Authentication | Signed out; invalid password401 displayed; valid test credentials signed in | Works; error is clear. No recovery/password-change test. |
| Company lifecycle | Created secondary company; renamed; archived through confirmation; restored from archived list | Works. Create/archive automatically switch context and return to Dashboard; operator needs to return to Companies to continue. |
| Module setting | Disabled Billing, reloaded and verified link hidden; re-enabled, reloaded and verified restored | Works as UI preference; prior API enforcement finding remains. |
| Platform and fixed tier | Created AuditChannel and Flipkart Audit Standard ₹15 tier; reloaded and expanded card | Persist. Platform creation silently ignored blank CR inputs despite zero placeholders. |
| Vendor/category | Created Audit Supplier/AUD and Audit Jewellery; checked after reload | Straightforward creation. Not every edit/delete permutation exercised. |
| Product CSV import | Selected UTF-8 synthetic template-shaped CSV, reviewed preview, imported to grid | Identity/rates retained; costs under ₹ headers became blank. Save All disabled until price entered. |
| Grid/product save | Entered missing cost100, packaging10, logistics15, misc5; saved and reloaded | Works once valid. Very dense desktop grid; blank drafts count as rows. |
| Inventory | Navigated using sidebar and found saved SKU | Catalog record visible; not evidence of warehouse/stock movements. |
| XLSX product import | Same style currency headers; imported AUDIT-XLSX with cost80, packaging10, logistics5, misc3; saved/reloaded | Works and supplies a control against CSV failure. |
| Export | Clicked XLSX and CSV exports; verified downloaded files and parsed rows | Both exports contain header plus two test SKUs. Output copies under operator/. |
| Pricing | Selected SKU; edited cost90→95 and GST0→5; Update & Recalculate; reloaded and reopened | Works and persists. The GST0 came from report recovery, not a user-requested tax change. |
| Invoice | Created2×₹250 +5% GST =₹525; edited notes; marked paid; reloaded; opened document preview | Values/payments correct for fixture. Reload defaults to Reports; user must reopen Invoices tab. Native PDF printing remains unverified. |
| Destructive cancellation | Opened invoice delete confirmation; pressed Enter on Cancel | Invoice preserved. Confirms selected repair of earlier UX-01 in real browser. |
| Mobile invoice | At390×844 filled and saved ₹100 + default3% GST invoice; reloaded and found it | Works. Root width390, main scroll width369; no page-wide horizontal overflow. Form requires substantial vertical scrolling. |
| Expense ledger | Created₹700 entry, reloaded, edited to₹750 | Works. Operator must select category deliberately; default inventory persisted for a note describing packaging. |
| Supplier bill/order upload | Uploaded synthetic Vyapar PDF and separate Flipkart order CSV | Parsed and persisted one₹360 bill and displayed one₹500 order independently. No invented purchase/sale relationship. |
| Bill matching and cost application | Suggested cost application rejected400; keyboard selected SKU; pack2; applied unit cost₹90; reloaded | Backend protects unconfirmed suggestion. SKU link, pack and cost persist. Apply button initially invites a rejected operation; error remains visible after some successful actions. |
| Settlement import | Meesho synthetic2-unit ₹500 sale /₹450 payout workbook through Upload Report | Financial report saves200, but optional fraud processing fails with explicit warning. |
| Missing-cost recovery | Fix→Add cost→Save & match; reloaded and verified payout₹450 | Matches report, but resets existing GST5→0 and requires re-entering known costs. |
| Duplicate/replacement | Re-uploaded exact same period; conflict409; Keep Existing; then Replace | Exact duplicate detection works; replacement leaves one new report (ID2). Keep Existing returns to underlying upload form. Warning persists after replacement. |

`operator-final-evidence.receipt.json` records these journeys and mutation responses. Event listeners on the acquired page do not survive reloads; that response list is therefore **not an exhaustive network log**. Backend logs, database history and persistence checks supply complementary evidence. A manual page.fetch GET returned401 because it omitted the frontend bearer header; this is an audit-probe limitation, not an authentication defect.

## Additional confirmed findings

### O19 — P1: successful settlement uploads leave fraud processing incomplete

**Reproduction:** Upload `C:\WorkStation\Projects\Python\Casper\audit\browser-audit\operator\meesho-synthetic.xlsx` via Meesho→Upload Report in a freshly migrated test company. Repeat via Replace.

**Actual:** HTTP200, correct ₹500/₹450 monetary report, status `done_with_warnings`, warning “Fraud processing incomplete; reprocess this report to retry.” Backend raises `InvalidRequestError: Can't operate on closed transaction inside context manager` when computing state profiles. Repeated on replacement. This was not a corrupt/missing-column fixture error.

**Cause:** `C:\WorkStation\Projects\Python\Casper\backend\app\services\pnl.py:1051` opens a nested transaction for the risk pipeline. `C:\WorkStation\Projects\Python\Casper\backend\app\services\fraud.py:663` commits inside return-reason computation; subsequent state-profile query at `:675` operates inside the closed transaction context.

**Expected/fix:** One service-level transaction owner; subordinate computations flush, not commit the enclosing transaction. Retain truthful warning/status and expose a working retry path. Verify empty and nonempty order populations, successful complete pipeline, failure rollback and replacement atomically. Existing selected regression tests did not cover this real import chain.

Evidence: `operator-meesho-upload-settled.receipt.json`, `operator-upload-warning-detail.receipt.json`, `operator-backend.stderr.log`, `operator-database-evidence.json`.

### O20 — P1: missing-cost recovery silently resets existing tax configuration

**Reproduction:** Save AUDIT-NECKLACE with GST5%; upload report where it lacks the needed marketplace mapping; Fix→Add cost, enter costs/rates without a GST control, then Save & match.

**Actual:** Existing base pricing GST5 becomes0. Financial history change17 records before5/after0. Pricing dialog later showed0, and a separate explicit edit restored5 (change19). The recovery form does not offer GST. This is not an inferred mismatch: database history proves the write.

**Cause:** `C:\WorkStation\Projects\Python\Casper\backend\app\services\pnl_statement.py:685` constructs EntryRowInput for an existing SKU; `C:\WorkStation\Projects\Python\Casper\backend\app\schemas\entries.py:53` defaults omitted GST to0; `C:\WorkStation\Projects\Python\Casper\backend\app\services\entries.py:167` materializes it. Frontend hidden-cost form: `C:\WorkStation\Projects\Python\Casper\frontend\src\pages\PnL\flipkart\ProfitLossView.jsx:87`.

**Expected/fix:** Reuse existing cost/tax/category/vendor configuration for an existing SKU, then apply explicit changes only. Distinguish omitted/inherited/zero values; disclose the affected base pricing and frozen report basis. Test existing GST0/5/18, an unmapped alias, new SKU defaults and snapshot preservation.

### O21 — P2: template-shaped UTF-8 CSV loses currency-labelled cost fields

**Reproduction:** Import `C:\WorkStation\Projects\Python\Casper\audit\browser-audit\operator\sku-import.csv` (UTF-8 without BOM), with Product Cost ₹/Packaging ₹/Logistics ₹/Misc ₹ headers. Compare `sku-control.xlsx` with equivalent headers.

**Actual:** CSV identifies SKU/vendor/category/rates but leaves costs blank. XLSX retains them. The price must be entered manually before Save All becomes enabled; original entered ₹ values are silently lost during import, rather than explained as errors.

Source: `C:\WorkStation\Projects\Python\Casper\frontend\src\pages\SKUs.jsx:1448` reads an ArrayBuffer without explicit CSV text decoding; header normalization/lookup follows at `:1454`. The observed behavior confirms CSV parsing incompatibility; encoding/decoded-header handling is the likely mechanism, not separately instrumented inside the library.

**Expected/fix:** Decode CSV as UTF-8 text explicitly, preserve supported headers and zero values, and show missing/unrecognized field warnings. Round-trip both downloaded template formats, BOM/no-BOM, currency headers, non-English names and mixed header aliases. Evidence: `operator-sku-state.receipt.json`, `operator-xlsx-import-control.receipt.json`.

### O22 — P2: required platform fields fail silently

**Reproduction:** Settings→Add Platform, fill Name and default rates; leave CR Charge and CR% blank where placeholders say0; click Create Platform.

**Actual:** Nothing submits, no error appears. Entering explicit0 in both fields creates the platform. `C:\WorkStation\Projects\Python\Casper\frontend\src\pages\Settings.jsx:465` returns without feedback.

**Expected/fix:** Use actual0 defaults or show labelled required-field errors and focus the invalid input. Test blank, valid zero and invalid negative/range values. Evidence: `operator-platform-result.receipt.json`, `operator-platform-filled-cr.receipt.json`.

### O23 — P2: supplier upload leaves visible ledger totals stale

**Reproduction:** Create₹750 expense, then upload a₹360 supplier bill using Bill Discrepancies.

**Actual:** Child bill view reports saved bill, but parent TOTAL OUT remains₹750/1 entry. Reload displays₹1,110/2 entries. Persisted ledger is correct; page state is stale. `C:\WorkStation\Projects\Python\Casper\frontend\src\pages\Ledger.jsx:207` mounts BillDiscrepancies without a completion refresh callback; child upload updates only local state at `C:\WorkStation\Projects\Python\Casper\frontend\src\components\BillDiscrepancies.jsx:64`.

**Expected/fix:** Invalidate/reload the owning ledger summary/entries after supplier save. Test first upload, re-upload idempotency, date filters and failed upload. Evidence: `operator-bills-orders-upload.receipt.json`, `operator-bill-cost-persisted.receipt.json`, `operator-supplier-bill.png`.

### O24 — P2: upload timestamps are interpreted in the wrong timezone

**Reproduction:** Upload a report around20:13 Asia/Calcutta, then re-upload and inspect conflict's Uploaded field.

**Actual:** Displays approximately14:43, the UTC clock time presented as local. Model stores naiveUTC (`C:\WorkStation\Projects\Python\Casper\backend\app\models\pnl.py:19`, `C:\WorkStation\Projects\Python\Casper\backend\app\core\time.py:8`); conflict UI uses `new Date(conflict.uploaded_at).toLocaleString('en-IN')` at `C:\WorkStation\Projects\Python\Casper\frontend\src\pages\PnL\PnLList.jsx:493`. Naive timestamp lacks timezone designation.

**Expected/fix:** Return timezone-aware UTC ISO timestamps and localize consistently; test positive/negative offsets and daylight-saving boundaries. Evidence: `operator-match-duplicate-check.receipt.json`, backend log and stored report timestamps.

## Ease of use and recommendations

This is an expert operator assessment from the tested tasks, not a timed human usability study or statistically meaningful usability score.

**Navigation: reasonably easy on desktop and tested mobile.** The sidebar exposes product, vendor, pricing, billing, ledger, companies and platform settings. Labels and selected dialog behavior are improved. However the same marketplace name appears in sidebar and settings, so context matters; company lifecycle redirects can interrupt a multi-step management task. Numerous Overview entries and Coming Soon reports add noise.

**Initial setup: moderately difficult.** Basic vendor/category creation is clear. Platform creation hides required inputs, fees/defaults/overrides need domain knowledge, and account's platform-level Viewer label can confuse a company owner. Explain current company capability separately from platform role.

**Products/pricing: difficult for a new operator, efficient only with training.** The desktop spreadsheet offers density, many platform columns and explicit controls, but blank draft rows, auto/manual pairs and incomplete import feedback create uncertainty. The XLSX path works; CSV and recovery must preserve money/tax inputs. A clear validation summary, import mapping preview and defaults/provenance would reduce uncertainty without sacrificing density.

**Invoices/expenses: comparatively straightforward.** Creation, edits, payment and reload work for the fixtures. Mobile entry is functional with long vertical scrolling. Tab state resets on reload; selected form labels and money explanations work. Invoice issuance/correction rules and print-document requirements remain unresolved.

**Supplier bills: conceptually sound but moderately difficult.** Explicit pack conversion and independent order/purchase data are strengths. Suggested SKU matches should have an obvious Confirm step; disable Apply until eligible instead of relying on a server rejection. Clear stale errors after success and refresh parent money totals.

**Reports/analytics: currently hard to trust.** Exact-duplicate and replacement UI work, but incomplete fraud processing, silent tax reset, omitted-cost presentation and the earlier scope/denominator defects prevent a reliable business narrative. Show pipeline stage status, error recovery and cost coverage before offering action recommendations.

## Remaining operations and blockers

- Native Download/Print PDF output was not verified: installed Tabbit CLI exposes page interaction/file fetch, but no documented native print-dialog control in this session. The document preview was exercised; no printer jobs or OS dialogs were simulated as proof.
- Other marketplace import/write lifecycles (Flipkart/Snapdeal/ShopDeck), every ad-report format, every override/tier mode, partial-payment/overdue scenarios and all deletion permutations remain untested. Earlier existing-report inspections are complementary, not substitutes.
- No membership role/invite grants or credential changes, per original constraints. Owner/admin/viewer API isolation from the earlier disposable probes still applies; a full multi-user browser lifecycle remains untested.
- No deployment, external bank/marketplace reconciliation, formal accessibility study or stock-ledger certification.
- Successful export files were verified, but re-importing every exported column/platform override was not tested.
- The previous localhost5173 service outage did not prevent this isolated walkthrough; it does not establish restored availability of the original services.

## Artifacts, test data and cleanup

All helpers/receipts/evidence are under `C:\WorkStation\Projects\Python\Casper\audit\browser-audit\`. New screenshots: `operator-supplier-bill.png`, `operator-unmatched-report.png`, `operator-mobile-billing.png`; all opened and visually inspected. Detailed state: `operator-database-evidence.json`, `operator-final-evidence.receipt.json`, backend/Vite logs. Synthetic PDF/XLSX/CSV inputs, DB, uploads and parsed export verification remain under `operator\` for review. Download copies also remain at `C:\Users\MSI-PC\Downloads\casper_skus_2026-10-04.xlsx` and `.csv`.

Persistent disposable records include one test account, two companies, two SKUs/pricing rows, one vendor/category, custom platform/tier, two invoices, an expense plus supplier-derived ledger entry, one supplier bill/link/pack alias, replacement settlement report and generated financial history. Exact records are available in the retained database. No real company finance was mutated.

The operator-created browser page is closed and Tabbit task finished after evidence export. Only the verified audit-owned server processes are stopped; the disposable database/evidence is retained. No new application tests were added and the earlier green suites were not rerun without implementation changes. These browser journeys, logs and persisted records are the new validation evidence.
