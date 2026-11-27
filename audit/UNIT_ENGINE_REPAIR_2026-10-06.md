# Unit engine verification and repairs

Implemented and tested on 2026-10-06. Existing database prices and historical report snapshots were not rewritten.

## Implemented
- Shared backend allowance resolver for grid saves and dedicated pricing: explicit amounts, zero overrides and derived percentage/cost precision now agree.
- Half-up money rounding for the base pricing calculation and grid preview, including whole-rupee target midpoint ties. Backend uses Decimal for the base cost/profit/tax arithmetic.
- Grid loads company damage defaults instead of ignoring the settings response; blank return percentage uses the platform default when available.
- Rupee profit edits now persist as equivalent markup rather than being discarded in the batch payload. Global profit input and changed local miscellaneous defaults are included when saving.
- Newly imported reports no longer subtract target cost markup from imported settlement margin: that variance is unavailable because the bases are not comparable. Existing records were not retroactively altered.

## Executed checks
Shared fixture audit/unit-engine-cases.json is exercised by the actual frontend compute function and by backend batch save, dedicated pricing handler, and report snapshot construction. Cases include whole-rupee midpoint, fractional components, absolute overrides and snapshot immutability. Separate tests cover derived allowance precision, zero overrides, actual autosave of a rupee profit edit, company/platform defaults, advertising and fixed/percentage tier planning.

394 backend tests passed. 129 frontend tests passed. Build passed. Browser visual verification remains unavailable in this chat.

## Remaining scope, not claimed fixed
The platform planning preview includes advertising/tier fees, while report cost snapshots use persisted base pricing. They are different calculations, not proven equivalent; blindly copying marketplace deductions into COGS risks double counting. Platform-specific cost/target persistence, alias-to-base pricing behaviour, bill-to-first-pricing setup, automated report recovery and effective-dated purchase cost policy remain open architectural work. The feature-flow audit also contains non-engine gaps not addressed in this repair.

No claim of complete engine parity for every arbitrary input, historical tax treatment or all platform parsers. Existing financial data has not been migrated to the new rounding policy; new saves use it.
