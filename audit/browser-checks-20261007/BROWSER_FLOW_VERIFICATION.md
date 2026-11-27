# Browser flow verification — 7–9 October 2026

The walkthrough used a fresh synthetic SQLite database and separate backend/frontend ports (8766/5174). No financial records were copied from the working database. The original application ports were only opened read-only to confirm browser access.

## Confirmed end-to-end flows

| Flow | Browser evidence |
| --- | --- |
| Supplier bill → product → pricing → P&L | Linked the uploaded marketplace name “Candy Tray Listing” to existing `TRAY-P1` while it had no cost. Set bill rate ₹270 with pack 6, giving ₹45 per product unit. The already uploaded report recovered automatically: 3 units, ₹135 frozen cost, ₹540 payout, ₹405 profit. Refresh retained the result. |
| Settings preview → apply → history → undo | Previewed a derived cost change (₹100→₹110), applied it, and undid it through history. A second apply exposed a stale history panel; the panel now refreshes immediately. |
| Invoice → receipt → ledger → reversal | Recorded ₹40 and then ₹100 receipts on a synthetic ₹100 invoice in separate trials, verified paid/outstanding totals after reload, reversed both, and verified equal offsetting ledger postings and restored ₹100 balance. The mobile form fits a 390×844 viewport. |
| Supplier alternate names | Added an alternate supplier name, reloaded, then removed it; the saved name survived reload before removal. |
| Ledger route | Reload retained `/ledger?tab=discrepancies` and `/ledger?tab=entries`. Generated receipt postings now identify their source and do not offer Edit/Delete controls that the API rejects. |

## Browser findings fixed

1. Pricing apply did not refresh the visible financial history until page reload. `PricingRefresh` now notifies `Settings` so `FinancialHistory` reloads after successful apply.
2. Receipt and related workflow dialogs inherited cramped native fields; the invoice list's Receipts button was too narrow. Added shared dialog form styling and a flexible button width. Desktop and mobile screenshots were inspected.
3. P&L called profit divided by cost “Net Margin.” It is now labelled “Return on cost,” including the GST basis variant. Calculation buttons exposed `[object Object]` to screen readers for styled values; they now expose the displayed number. Singular SKU counts also read correctly.
4. Generated invoice ledger postings showed Edit/Delete even though the API returned 409. Ledger API rows now identify source type, and the UI shows “Invoice receipt” or “Supplier bill” instead of invalid actions. The backend guard remains in place.

## Verification

- Browser: login, supplier alias persistence, pricing preview/apply/undo, marketplace link, bill pack conversion, report cost recovery, invoice payment/reversal, ledger totals and path refresh, mobile receipt dialog, and the final P&L labels were observed in Tabbit.
- Frontend: full suite 135 passed after the dialog/history/label fixes; focused P&L and pricing tests 41 passed after accessible-label fix. Lint and production build passed. The final ledger column heading was a text-only change after that run.
- Backend: full suite 410 passed before this browser pass; the receipt and generated-ledger route tests passed (2) after adding source metadata. The full backend suite was not rerun after that small route change.
- The disposable browser servers were stopped after verification. The normal app was restarted at `http://127.0.0.1:5173/` with backend port 8765; the frontend returned 200 and backend `/health` returned 200 on 9 October.
- These checks cover the connected flows listed here, not every route or accounting workflow. Inventory stock balance and valuation remain undefined pending the P1/P2/P6 shared-versus-separate stock decision. Cross-module accounting and universal undo also remain open as described in `audit/CONNECTION_REPAIR_PHASE2_2026-10-07.md`.

## Screenshots

- `desktop-receipt.png`, `mobile-receipt.png`
- `recovered-report.png`, `ledger-postings.png`
