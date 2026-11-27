# Casper code standards and UI/UX audit — 4 October 2026

This supplements the [full-stack audit](C:/WorkStation/Projects/Python/Casper/audit/PROJECT_AUDIT_2026-10-03.md). The product has useful building blocks—shared API helpers, route splitting, backend schemas, confirmation components, and substantial formula tests—but reliability and accessibility are inconsistent across screens. Fix the destructive keyboard behavior, missing mobile navigation, and broken export before investing in visual polish.

## Scope and verification

- Reviewed the application shell, authentication/company contexts, shared controls, catalog editing/import/export, pricing, team management, billing, ledger, P&L, dashboard, styling, and quality tooling.
- Ran the existing ESLint configuration against 77 frontend source/test files; results saved in [eslint-results.json](C:/WorkStation/Projects/Python/Casper/audit/eslint-results.json).
- Exercised the real frontend in Tabbit with synthetic company/SKU/member/bill data. Intercepted API requests; all writes were blocked. No live records were edited.
- Browser-confirmed: Cancel/Enter issues DELETE, mobile navigation disappears, Excel export throws, a 503 is described as a missing report, autocomplete traps Tab, and pricing displays incorrect units/status. [Browser evidence](C:/WorkStation/Projects/Python/Casper/audit/ux-browser-evidence.json).
- Calculated contrast and reproduced CSV/date behavior using [standards-evidence.cjs](C:/WorkStation/Projects/Python/Casper/audit/standards-evidence.cjs). [Results](C:/WorkStation/Projects/Python/Casper/audit/standards-evidence.json).
- Existing backend/frontend tests and build passed during the preceding audit (309 backend tests, 103 frontend tests). They were not rerun for this documentation-only extension. Their success does not cover the browser defects below.
- Desktop screenshot was inspected; mobile screenshot capture timed out. Mobile navigation is confirmed through computed visibility and browser observation. This is not a complete screen-reader, touch-device, or cross-browser certification.
- Source code and existing user changes were preserved. Files added by this extension are audit artifacts only.

P1 means repair promptly because a core flow breaks or an unintended destructive action can occur. P2 means a concrete usability/correctness defect that should follow. “Source-confirmed” means the behavior follows directly from inspected code; it has not necessarily been exercised end to end.

## Findings

### UX-01 · P1 · Cancel can execute a destructive action — browser-confirmed

[ConfirmDialog.jsx:21](C:/WorkStation/Projects/Python/Casper/frontend/src/components/ConfirmDialog.jsx:21)

The document-level keydown handler calls `onConfirm` for every Enter key, regardless of focused element. In Team, I opened Remove, focused Cancel, and pressed Enter. The frontend issued `DELETE /companies/101/members/102`; the audit interceptor returned 403. Initial focus is also placed on the destructive button.

Remove global Enter confirmation and let the focused button handle native keyboard activation. Focus Cancel for destructive prompts, constrain focus within the dialog, and restore focus to its trigger. Verify Cancel/Enter never calls DELETE and Confirm/Enter calls it once.

### UX-02 · P1 · Mobile removes the primary navigation and company switcher — browser-confirmed

[Layout.css:408](C:/WorkStation/Projects/Python/Casper/frontend/src/components/Layout.css:408), [Layout.jsx:237](C:/WorkStation/Projects/Python/Casper/frontend/src/components/Layout.jsx:237)

At widths below 900px the tree disappears; below 640px the rail disappears too. At 390px both were `display:none`, with zero visible navigation regions or company switchers. The topbar retains account/new-pricing buttons and search, but no replacement menu. Tablet users also lose tree-only destinations such as billing, ledger, and company management. Search is not a complete replacement and its result items are not keyboard-operable.

Provide an accessible menu/drawer at the same breakpoints, including company selection and sign out. Keep current route and company visible. Check every destination at 390px, 768px, and desktop widths.

### UX-03 · P1 · Excel export fails — browser-confirmed

[SKUs.jsx:1548](C:/WorkStation/Projects/Python/Casper/frontend/src/pages/SKUs.jsx:1548)

Export as .xlsx raises `ReferenceError: XLSX is not defined`. Template download and import dynamically load XLSX inside their own functions; export references that local variable from outside its scope. Vite build succeeds despite this runtime failure, while ESLint correctly identifies it.

Load the library in the export path, handle download errors visibly, and verify an exported workbook can be reopened with the expected headers and rows.

### UX-04 · P2 · Autocomplete traps Tab and lacks accessible semantics — browser-confirmed/source-confirmed

[SmartCell.jsx:75](C:/WorkStation/Projects/Python/Casper/frontend/src/components/SmartCell.jsx:75), [BillDiscrepancies.jsx:190](C:/WorkStation/Projects/Python/Casper/frontend/src/components/BillDiscrepancies.jsx:190)

When open, the component prevents Tab even if there are no matching options and no Add New action. I typed `NO-MATCH-AUDIT` in bill matching; Tab left focus on the same input. With matches it selects and blurs rather than moving predictably to the next control. The input/options have no combobox/listbox relationship or active-option announcement. Read-only inputs can still open suggestions and call selection handlers. The Manage action is excluded from keyboard navigation.

Allow normal Tab traversal, use Enter for selection, close on blur, guard read-only interactions, and implement labeled combobox/listbox semantics with active-option scrolling. Test no-match, read-only, and keyboard-only paths.

### UX-05 · P2 · Pricing mislabels tax and status — browser-confirmed

[Pricing.jsx:19](C:/WorkStation/Projects/Python/Casper/frontend/src/pages/Pricing.jsx:19), [sku.py:102](C:/WorkStation/Projects/Python/Casper/backend/app/schemas/sku.py:102), [pricing.py:68](C:/WorkStation/Projects/Python/Casper/backend/app/services/pricing.py:68)

The backend defines GST as a percentage, but the card displays `₹18` for rate 18 and the edit form labels it `GST (₹)`. The card reads `row.is_active`, which PricingResponse does not contain, so valid pricing appears Inactive. Both appeared with an API-shaped synthetic record.

Display GST as a rate and derive activity from a defined field (for example the platform), or remove the status badge. Clarify Product Cost versus selling-price/settlement terminology across pricing and Unit Economics.

### UX-06 · P2 · Editing rates silently turns calculated costs into overrides — source-confirmed

[Pricing.jsx:114](C:/WorkStation/Projects/Python/Casper/frontend/src/pages/Pricing.jsx:114), [pricing.py:128](C:/WorkStation/Projects/Python/Casper/backend/app/services/pricing.py:128)

Opening Edit copies resolved CR, damage, and misc costs into fields labeled “override.” Save submits every nonblank cost; the backend prioritizes these amounts over percentages. Thus changing CR percentage from 5 to 10 can retain the old CR cost of ₹2.50, although the action promises “Update & Recalculate.” The API does not distinguish a resolved amount from the user's override intent.

Represent Automatic/Manual mode explicitly in storage and API responses. Keep automatic values as read-only previews; submit overrides only in Manual mode. Show which defaults apply. The earlier audit also covers the inability to clear persisted overrides.

### UX-07 · P2 · Server failures become empty data or misleading “not found” — browser-confirmed/source-confirmed

[PnLReport.jsx:49](C:/WorkStation/Projects/Python/Casper/frontend/src/pages/PnL/PnLReport.jsx:49), [PnLList.jsx:70](C:/WorkStation/Projects/Python/Casper/frontend/src/pages/PnL/PnLList.jsx:70), [Dashboard.jsx:277](C:/WorkStation/Projects/Python/Casper/frontend/src/pages/Dashboard.jsx:277), [AuthContext.jsx:12](C:/WorkStation/Projects/Python/Casper/frontend/src/context/AuthContext.jsx:12)

A synthetic 503 on report loading displayed “Report not found.” List loading only logs its failure and then shows an empty report state. Dashboard's main `Promise.all` lacks a rejection handler; failure of either core request discards the combined result and ends loading with initial/empty values. Failed session restoration leaves `user` null, which redirects to login even for a network outage while retaining tokens.

Distinguish loading, empty, forbidden, expired-session, not-found, and unavailable states. Provide retry and show stale data explicitly when appropriate. Do not present unavailable financial data as zero or an onboarding state.

### UX-08 · P2 · Financial actions and module changes can fail silently — source-confirmed

[Billing.jsx:134](C:/WorkStation/Projects/Python/Casper/frontend/src/pages/Billing.jsx:134), [Settings.jsx:25](C:/WorkStation/Projects/Python/Casper/frontend/src/pages/Settings.jsx:25)

Mark Paid and Delete catch and ignore errors. A failed confirmation closes, with no explanation of why the invoice remains. Module toggles also swallow errors. Several lookup and bill-loading paths turn failures into empty arrays.

Track pending actions per record, prevent duplicate submissions, and display actionable failure feedback. Announce successful actions through a live status region. An error must not look like successful completion or an empty catalog.

### UX-09 · P2 · Pricing selection can show another SKU's results — source-confirmed

[Pricing.jsx:102](C:/WorkStation/Projects/Python/Casper/frontend/src/pages/Pricing.jsx:102)

Changing selected SKU starts a new request without canceling or ignoring the old one. A slow response for A can overwrite rows after B is selected, and either request can dismiss the loader while the other is pending. Users can then act on pricing inconsistent with the selected SKU.

Key requests/results by SKU and company, cancel stale fetches or check a request generation before setting state, and clear or label stale rows while loading. Apply the same pattern to list/context effects that depend on a changing identifier.

### UX-10 · P2 · CSV escaping corrupts legitimate values — deterministic reproduction

[SKUs.jsx:1562](C:/WorkStation/Projects/Python/Casper/frontend/src/pages/SKUs.jsx:1562)

The escape function quotes only values containing commas and never doubles embedded quotes. `ACME, "North"` produces malformed quoted CSV; a newline without a comma produces a second record. Ledger already uses a safer escaping approach, demonstrating inconsistent shared behavior.

Use one tested CSV writer across exports, including quote/newline/Unicode cases. Treat export/import as a defined round trip; explicitly document fields such as series/HSN and overrides that the current exported format does not preserve.

### UX-11 · P2 · Invoice preview uses the active view as issuer — source-confirmed

[Billing.jsx:310](C:/WorkStation/Projects/Python/Casper/frontend/src/pages/Billing.jsx:310)

The printable document displays `activeCompany.name` instead of the invoice's owning company. In group mode this prints “All Companies” as issuer, although an invoice belongs to a specific company.

Resolve seller identity from `printInv.company_id` or an invoice seller snapshot. Include the seller fields needed for a useful document and keep that identity stable when companies are renamed or archived. Verify printing from group mode.

### UX-12 · P2 · New financial records can default to yesterday — deterministic reproduction

[Billing.jsx:11](C:/WorkStation/Projects/Python/Casper/frontend/src/pages/Billing.jsx:11), [Ledger.jsx:19](C:/WorkStation/Projects/Python/Casper/frontend/src/pages/Ledger.jsx:19)

`toISOString().slice(0,10)` uses UTC. At 01:00 on 4 October in Asia/Calcutta it returns 3 October. Before 05:30 IST, new invoice/ledger drafts use the preceding date. The same helper influences ledger “this month” selection at a month boundary.

Use an explicit business-date/timezone policy and a shared local date helper. Test midnight and month/year boundaries.

### UX-13 · P2 · Form labels disappear or are not connected to controls — source-confirmed

[Billing.jsx:239](C:/WorkStation/Projects/Python/Casper/frontend/src/pages/Billing.jsx:239), [Billing.css:17](C:/WorkStation/Projects/Python/Casper/frontend/src/pages/Billing.css:17), [Pricing.jsx:233](C:/WorkStation/Projects/Python/Casper/frontend/src/pages/Pricing.jsx:233)

Invoice line quantity/unit-price fields have no programmatic labels; mobile hides their column headings, leaving bare numeric inputs. Pricing's visual labels are sibling elements without matching `htmlFor`/IDs for several inputs. Repeated remove/edit controls need record-specific names for users navigating a control list.

Keep visible labels on stacked mobile fields, connect labels to inputs, and add row/item context to repeated actions. Associate helper/error text through `aria-describedby` and set `aria-invalid` after validation.

### UX-14 · P2 · Modal behavior is inconsistent and incomplete — source-confirmed

[ConfirmDialog.jsx:36](C:/WorkStation/Projects/Python/Casper/frontend/src/components/ConfirmDialog.jsx:36), [Pricing.jsx:335](C:/WorkStation/Projects/Python/Casper/frontend/src/pages/Pricing.jsx:335)

The shared dialog has an alertdialog role but no focus trap, focus restoration, or background inert handling. Pricing builds separate overlay/modals without dialog roles or common keyboard behavior. This inconsistency is why the first pricing-modal probe found no accessible dialog despite a visible confirmation.

Use one dialog implementation with a title/description, safe initial focus, focus containment/restoration, and intentional Escape/backdrop policy. Keep failures visible when a confirmed operation fails.

### UX-15 · P2 · Disabled-module recovery and navigation disagree — source-confirmed

[Settings.jsx:8](C:/WorkStation/Projects/Python/Casper/frontend/src/pages/Settings.jsx:8), [App.jsx:71](C:/WorkStation/Projects/Python/Casper/frontend/src/App.jsx:71), [Layout.jsx:243](C:/WorkStation/Projects/Python/Casper/frontend/src/components/Layout.jsx:243)

The gate tells users to re-enable a module under Settings, but the settings list omits billing and ledger. If those are disabled via configuration/API, that UI cannot restore them. Only the Workspace navigation list applies the module filter; rail and separate P&L/fraud links can still lead to disabled screens. Context starts with `{}`, which treats modules as enabled until loading finishes.

Generate gates, navigation, and settings from a common module registry; define context loading/failure states. Feature visibility is a UX control, and must remain separate from backend authorization.

### UX-16 · P2 · Financial explanations and sorting require a mouse — source-confirmed

[ProfitLossView.jsx:32](C:/WorkStation/Projects/Python/Casper/frontend/src/pages/PnL/flipkart/ProfitLossView.jsx:32), [ProfitLossView.jsx:378](C:/WorkStation/Projects/Python/Casper/frontend/src/pages/PnL/flipkart/ProfitLossView.jsx:378), [Layout.jsx:419](C:/WorkStation/Projects/Python/Casper/frontend/src/components/Layout.jsx:419)

Calculation popovers respond only to mouse enter/leave. Sortable column headings use `onClick` on `<th>` without a button or `aria-sort`; search results and several navigation section toggles are clickable divs without keyboard handling.

Use native buttons/links and accessible expanded/sort state. Offer calculation details on focus and click/tap as well as hover. Users should be able to inspect why a financial result changed without needing a mouse.

### UX-17 · P2 · Small muted text has weak contrast — measured design issue

[index.css:12](C:/WorkStation/Projects/Python/Casper/frontend/src/index.css:12)

The shared muted color `#9A9A9F` has a contrast ratio of **2.80:1** against white. It is widely used for small labels/help text. Desktop inspection also showed dense, small pricing/navigation labels; making essential units and explanations this subdued reduces readability.

Darken the muted text token, reserve lighter shades for decoration, and establish a consistent readable type scale. Validate each semantic token against its actual background; do not rely on color alone for status/profit/loss.

### UX-18 · P2 · Fatal errors expose a stack with no recovery path — source-confirmed

[App.jsx:6](C:/WorkStation/Projects/Python/Casper/frontend/src/App.jsx:6)

The root error boundary replaces the application with a raw red stack trace. It provides no recovery action, support reference, or accessible error announcement, and its error state persists across route changes. Event-handler errors such as the Excel defect are not caught by this boundary.

Provide a friendly recoverable error screen and correlation ID; log technical details separately. Add feature-level boundaries where one broken panel should not remove the entire shell, and handle event/async failures explicitly.

## Code standards assessment

| Area | Evidence | Improvement |
|---|---|---|
| Enforced frontend quality | ESLint is configured but not declared directly or exposed through package scripts. No quality workflow is present; the only workflow is keepalive. | Pin the toolchain; add lint/check scripts and CI gates for lint, tests, and build. |
| Lint signal | 77 files: 92 errors, 656 warnings. Production: 70 files, 8 errors, 625 warnings. 84 errors concern test globals. Six production errors are undefined XLSX references; two are empty catches. | Configure Vitest globals/test overrides first. Add React JSX/hooks and accessibility rules; avoid sweeping autofix while findings remain unresolved. |
| Warning interpretation | 244 curly, 242 unused-vars, 162 equality, 8 console warnings across all files. Missing React JSX usage rules cause some unused-component false positives. `== null` can be intentional. | Correct the configuration, then establish a reviewed baseline. Do not describe 656 warnings as 656 bugs. |
| Backend tooling | Backend ESLint ignores `*.py`; no Python lint/type-check configuration was found. | Adopt an explicit Python formatter/linter and gradual type checking around services/API contracts; use narrow, explained exceptions. |
| Contracts | Unchecked JS objects permit nonexistent status fields, unit confusion, and stale form payload semantics. | Generate or maintain typed API contracts from backend schemas. Introduce types/JSDoc at API and financial-domain boundaries first. |
| Structure | SKUs.jsx is 2,242 lines, Dashboard.jsx 1,211, fraud.py 1,937. UI state, formulas, persistence, and export logic coexist in large modules. | Extract coherent domain functions and feature hooks, with clear persistence/state ownership. Split by responsibility rather than arbitrary file size. |
| Shared behavior | Separate CSV writers, dialogs, date helpers, and failure conventions produce different outcomes across screens. | Share primitives for dates, money/rates, async states, confirmations, and exports. Preserve screen-specific domain rules explicitly. |
| Financial logic | The earlier audit reproduces divergent calculation/rounding and stale derived totals across paths. UI labels and override intent add further ambiguity. | Define one calculation specification with shared fixtures and exact unit/rounding contracts. Store monetary values under a consistent precision policy. |
| Observability | Production `setup_logging(..., dev=False)` uses file handlers and disables propagation for the application logger. | Ensure deployment logs reach the collected output or a documented collector. Correlate frontend failures with request IDs; keep user feedback distinct from stack traces. |
| Tests | Existing suites cover significant formulas/services but missed the confirmed keyboard/export/mobile defects. | Add targeted behavior tests for critical flows and a small browser smoke suite. Prioritize meaningful interactions over snapshots or tests that copy implementation formulas. |

## Recommended implementation order

1. **Repair core interactions:** Cancel/Enter deletion, mobile navigation/company selection, and Excel export. Add focused regression coverage for these three behaviors.
2. **Restore financial clarity:** GST/status labels, Automatic/Manual cost mode, correct invoice issuer, local business dates, and reliable import/export behavior. Coordinate with the prior audit's financial integrity fixes.
3. **Make failures recoverable:** consistent loading/empty/error states, retries, pending mutations, success announcements, and protection from stale responses. Clearly display autosave status and unsaved/failed rows; address the earlier audit's autosave/undo issues.
4. **Unify accessible primitives:** dialog, combobox, search, sortable table headings, tooltips, labeled mobile fields, and contrast tokens. Keep high-density desktop grids, but give mobile users task-oriented cards/forms with visible units.
5. **Enforce standards incrementally:** fix tooling false positives, add CI checks, type API contracts, and extract the financial/domain logic. Avoid a broad rewrite before the concrete defects are repaired.

Acceptance should include: canceling never mutates; changing company keeps ownership obvious; every primary flow remains reachable on mobile; automatic costs actually recalculate; outages never appear as zero financial results; exports reopen correctly; keyboard users can navigate, edit, confirm/cancel, and inspect calculations.

## Artifacts

- [Desktop pricing screenshot](C:/WorkStation/Projects/Python/Casper/audit/pricing-desktop.png)
- [Browser evidence](C:/WorkStation/Projects/Python/Casper/audit/ux-browser-evidence.json)
- [Standards evidence](C:/WorkStation/Projects/Python/Casper/audit/standards-evidence.json)
- [Raw ESLint results](C:/WorkStation/Projects/Python/Casper/audit/eslint-results.json)
- Browser fixture/check scripts in `audit/browser_*.js` document the synthetic scenarios; run the fixture first in an owned Tabbit scratch page. Audit writes are deliberately blocked.

No application fixes were made as part of this audit.
