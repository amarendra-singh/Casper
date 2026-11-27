# Ledger SKU search and matching

## Reproduced causes

- Automatic supplier suggestions indexed only internal SKU-code tokens, ignoring vendor codes and descriptions. Supplier wording and abbreviated codes therefore missed one another.
- The supplier search searched code/vendor code, but omitted descriptions and treated surrounding search whitespace literally. Empty results gave no feedback.
- Suggestions with equal token scores selected the first SKU, including when the alternatives were different pack sizes.
- Manually confirming bill lines did not propagate the allocation into the bill's single ledger entry. Previously, one known SKU amid unmatched lines could also be attributed to the whole bill.
- The ordinary ledger entry form used an unsearchable SKU dropdown showing only codes. The supplier catalogue was fetched once with no refresh control.

Regression tests reproduced the first four failures before the repairs.

## Changes

- Supplier suggestions use internal code, vendor code and description, scoped to the bill's company and active SKUs. Equal-best candidates remain unconfirmed; no pack size is inferred.
- Both ledger entry and supplier matching use SmartCell to search codes, vendor codes and descriptions. Search whitespace is trimmed and no-match feedback is visible. Supplier search can refresh its catalogue, and opening the ledger form reloads its SKU list.
- Supplier option selection uses the SKU ID instead of looking it up again by display text. Ledger form options in All Companies are restricted to the selected/existing record's company.
- Confirmed manual/remembered links update the aggregate ledger SKU only when every line is confirmed as the same SKU. Mixed or incomplete bills retain their individual SKU links in Bill Discrepancies, with no single-SKU allocation on the aggregate expense.
- Suggestions no longer populate ledger allocations or count as confirmed matches/cost mismatches. Link changes refresh ledger totals/entries, and warnings about unregistered suppliers are displayed.

## Naming and data limits

The supplied catalogue contains 21 base products; 19 correspond to 95 existing Majnu Bhai Sales pack variants after accounting for the catalogue's `MBG-SD-` prefix and app pack suffixes. That comparison was not an exact-code match or a persisted mapping. The supplier name, base product, pack variant and billed-unit conversion still require explicit confirmation. The two absent families remain `MBG-SD-WG-LBY-350` and `MBG-SD-WG-ROTA-300-ZZB-1B`.

No live bill links, vendor aliases, prices or financial records were rewritten. Existing bills are not silently rematched; choose the correct SKU and conversion in the UI. The registered supplier is required to remember a mapping for future imports.

## Verification

- Backend full suite: **375 passed**; includes synthetic API scope/search-field checks, descriptive suggestion matching, ambiguous pack rejection and manual allocation synchronization.
- Frontend suite: **119 passed**; includes description search/ID selection, catalogue refresh and ordinary ledger vendor-code search.
- Frontend lint and production build, configured backend Ruff, and Git whitespace checks pass.
- Logs: `ledger-sku-backend-tests.txt`, `ledger-sku-frontend-tests.txt`, `ledger-sku-frontend-build.txt`.
- Backend restarted to load the changes. Fresh visual browser verification remains unavailable due to this chat's saved browser restriction; interaction tests are DOM verification.
