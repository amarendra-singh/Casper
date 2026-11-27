# Workflow audit and supplier auto-matching repair

## Scope and evidence

Traced supplier statement parsing, persistence, supplier identity, candidate search, confirmation, remembered mappings, ledger allocation, cost application, re-upload and permission checks. Also reviewed authentication/session revocation, company-scoped writes, Unit Economics/pricing preservation, settings/platform deletion, invoice lifecycle/summary, report replacement and frozen P&L costs. Verification combines source review, synthetic service/API tests, React interaction tests and migration/rematching on a disposable copy of the current database.

No rendered browser walkthrough was performed: this chat's saved browser denial remains in effect. This report establishes the listed workflows and defects; it is not a claim that every screen or production condition is certified.

## Defects fixed in this pass

| Finding | Failure | Corrected behavior |
|---|---|---|
| Supplier identity | Unregistered JDS had NULL vendor ID; its remembered mappings were ignored. | Aliases are company/supplier scoped using the same stable supplier key as bills. Named suppliers work without a vendor registration. |
| Existing records | Matching ran on import only. Saved unmatched lines never reconsidered learned mappings. | Owner/admin opening Bill Discrepancies triggers idempotent matching of saved supplier mappings. Confirmation propagates to pending lines from that supplier. Refresh retries matching and candidate loading. |
| Pack ambiguity | Equal candidate scores disappeared from the UI, or older logic selected the first variant. | Reads compute candidates for existing lines. All equally supported pack variants are exposed with an explicit reason and choice. Candidate search uses model/vendor names and descriptions without equating distinct model codes. |
| Import preservation | Re-upload could overwrite manual mappings and show stale cached line objects. | Unambiguous confirmed line mappings survive corrected re-uploads; ORM line collections reflect the newly saved lines. |
| Supplier registration | Registering an already imported named supplier could change its key and duplicate bills/expenses. | Existing named-supplier identity remains stable when the supplier is later registered. |
| Clearing matches | Typing a new search cleared a saved match; forgotten aliases could restore it. | Searching is read-only. Clear match explicitly removes the line link and its remembered supplier mapping. |
| Conversion entry | Invalid/blank conversion silently became 1; fractional conversions were disallowed by the UI. | Positive finite conversions are validated, fractions allowed, and unconfirmed candidates cannot apply costs. |
| Statement money | Payment and credit/debit transactions could become additional positive inventory expenses. | Only supplier Sale invoice rows are posted by this purchase importer. Unsupported transactions are counted and disclosed; no guessed accounting treatment. |
| Ledger/source integrity | Generated bill expenses could be edited independently, or deletion failed through a foreign key. | Those writes return an actionable conflict directing correction through the source statement. |
| Invoice analytics | Unissued drafts could become overdue and inflate receivables. | Drafts remain drafts, are reported in their status group, and are excluded from invoiced/outstanding/overdue monetary totals. |
| Platform deletion | Deleting an in-use platform produced a server error. | A conflict explains that the platform must be deactivated to preserve referenced records. |
| Company UI | Supplier matching in All Companies issued a single-company request. | The page asks the user to choose the owning company; write controls respect company roles. |

## Actual JDS data

The spreadsheet comparison (19 of 21 base catalog products, 95 pack variants) was not a claim that all supplier bill lines matched. The actual current saved statement contains **19 lines**:

- **2 already confirmed:** AMORE and ZZB-C, with existing operator-selected conversions.
- **1 candidate line:** BRILLIANT, with P1/P2/P4/P6/P8 choices. No variant or conversion was guessed.
- **16 lines without a reliable catalog candidate.** These include missing codes PKTY-26, LS-001, 8292-C, Y1018-1E-D, J3524 and MSB-126. Other entries disagree with stored SKU identity: LZB-D versus ZZB-D, and Y3212 160 ML versus Y3212-1 146 ML.

The fixed system cannot honestly mark those 16 lines as confirmed without additional SKU records or explicit supplier mappings. The UI now distinguishes candidates from confirmed mappings and explains why a line remains unresolved.

Evidence: `deep-workflow-evidence-2026-10-05.json`. The disposable-copy check found no changes to ledger amounts, bill totals, product costs, breakeven or bank-settlement values.

## Migration and deployment

Migration `f6a0audit0006` adds supplier identity to aliases. Legacy mappings are assigned to a named supplier only when saved confirmed bill-line evidence identifies exactly one supplier; ambiguous legacy mappings remain inactive. Migration tests cover an empty schema and populated legacy data.

The local database was backed up to `audit/backups/casper-before-supplier-alias-2026-10-05.sqlite` before migration. Migration was applied and the backend restarted. No product costs or bill amounts were rewritten. Existing source observations and confirmed pack conversions were preserved.

## Verification boundaries

- Auth/tenancy: inspected token rotation/version checks and scoped references; existing tests cover replay rejection, logout/password revocation, foreign references and viewer write rejection.
- Unit Economics: inspected canonical pricing/upsert/defaults; existing regression coverage verifies taxes/overrides, rollback and recovery.
- P&L/analytics: existing tests exercise frozen costs, overlapping report exclusion, replacement failure, import risk processing and payout denominators. This pass corrected invoice draft accounting and verified supplier-money invariants.
- Inventory is currently a catalog view, not a stock movement/valuation ledger. A full inventory subsystem is not implemented by these repairs.
- Multi-worker concurrency, PostgreSQL runtime, visual/mobile rendering, accessibility and native print remain unverified. Shared production rate limiting, formal double-entry accounting, credit-note/refund lifecycle and durable claims management remain product/infrastructure work.

Final test results and commands are in `deep-audit-backend-tests-2026-10-05.txt`, `deep-audit-frontend-tests-2026-10-05.txt`, and `deep-audit-build-2026-10-05.txt`. Tests were extended to exercise failure paths and linked outcomes, not only isolated successful functions.

Final results: **388 backend tests passed**, **120 frontend tests passed**, frontend lint had **0 errors/0 tracked warnings**, production build passed, configured Ruff and Git whitespace checks passed. The restarted backend returned a healthy response. A read-only comparison of the migrated live database with its pre-migration backup confirmed that ledger amounts, bill totals, prices, breakeven and settlement values remained identical.
