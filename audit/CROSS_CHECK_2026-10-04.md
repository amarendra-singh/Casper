# Repair cross-check — 4 October 2026

Reviewed the preceding repair implementation, its regression tests, transaction boundaries and dependent UI refresh behavior. This is an additional review of those repairs, not certification of every product feature.

## Additional defects found and corrected

1. **Supplier upload results disappeared during ledger refresh.** The save callback set the parent loading state and unmounted BillDiscrepancies, losing the selected files, transient order results and confirmation. Ledger now refreshes totals in the background after supplier saves. A React interaction regression holds the refresh request pending and checks that the file and subsequent confirmation remain visible.
2. **Cost recovery could persist partial changes.** Pricing committed before rematching. Recovery now commits after rematching and remaining-hidden computation; the standalone rematch route owns its commit. The failure-injection test exposed a second issue: SQLite legacy transaction control can release a savepoint before a real outer transaction begins. The SQLite engine now explicitly begins transactions, with the same configuration used by the synthetic audit fixture. Rollback preserves the original price after an injected rematch failure.
3. **Cost recovery selected the wrong base pricing when row order differed from platform order.** Preservation now uses the same canonical platform-ID/pricing-ID ordering as entries reads and writes. A multi-platform regression verifies the canonical GST and price.
4. **Malformed hidden-SKU vendor/category IDs caused server errors.** Numeric conversion now returns validation feedback (422). A synthetic ASGI request verifies rejection.
5. **Payout comparisons used a net-margin availability filter and counted zero-GMV records.** Availability now depends on recorded settlement and positive GMV, the actual ratio inputs. A regression verifies a valid 70% payout insight with unknown net margin and excludes a zero-GMV platform from the comparison.

Also corrected damaged punctuation in the company-scope helper documentation.

## Validation

- Backend full suite: **371 passed** in 18.89 seconds; result recorded in `audit/cross-check-backend-tests.txt`.
- Frontend: **116 passed across 10 files**, including the new supplier-refresh interaction test.
- Frontend lint: **0 errors, 0 tracked warnings**.
- Production frontend build: passed.
- Configured backend Ruff checks and `git diff --check`: passed.
- Regression writes use synthetic in-memory records. No live financial records were changed.

Evidence: `cross-check-backend-tests.txt`, `cross-check-frontend-tests.txt`, and `cross-check-frontend-build.txt` in this directory.

## Limits

The saved browser security restriction still prevents a fresh rendered UI walkthrough in this chat. DOM tests do not establish visual fidelity or native print behavior. PostgreSQL and concurrent multi-worker imports remain unverified. Explicit SQLite transactions change transaction/locking behavior; concurrent production load requires separate testing. Larger capabilities still absent are listed in `REPAIRS_BROWSER_AUDIT_2026-10-04.md`.
