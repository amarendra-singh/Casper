# Connection repairs, second implementation pass — 7 October 2026

## Delivered

### Marketplace product identity

Added company/platform-scoped confirmed marketplace names linked directly to a product, independent of pricing. The missing-cost panel can search existing products and link an uploaded label. A later cost save uses that product instead of creating a duplicate. Existing internal codes and legacy platform names participate in conflict detection. Ambiguous identities stay unresolved. New uploads and later recovery use the same identity service. Missing-cost responses distinguish known, unknown and ambiguous products.

### Pricing refresh

Settings exposes a preview of saved pricing changes from current derived charges and miscellaneous defaults. Apply checks the preview fingerprint again and rejects stale previews. Explicit monetary overrides and saved percentages are preserved. Historical frozen costs remain unchanged; eligible unpriced reports can recover. Percentage inheritance cannot be reconstructed for legacy rows because the original schema did not record whether each percentage was inherited or explicitly entered. The UI explains this boundary.

### Invoice receipts, ledger and reversal

Billing now exposes Receipts for issued/overdue/paid invoices. A dated receipt posts one linked ledger income entry and updates the invoice balance atomically. Duplicate request keys return the original result; reusing a key for a different payment fails. Overpayments and payments on unissued invoices fail. Receipt reversal retains the original receipt and ledger entry, posts an equal offset, and reopens the balance. Repeating reversal adds no further entries. Generated receipt ledger entries cannot be directly edited, deleted or undone through generic ledger history.

The old cumulative amount-paid mutation is rejected; callers must use dated receipts. Invoice creation starts unpaid. Existing paid totals are preserved without invented receipt dates or ledger backfills. This is a cash-receipt workflow, not credit notes, bank reconciliation, revenue recognition or full accrual accounting. Reversal corrects a receipt posting; it does not cancel a sale or change invoice lines.

### Supplier names and history

Vendors exposes Supplier names: add/remove exact alternative names with company scope and duplicate/conflict checks. Saved bills and confirmed item mappings remain intact. Vendor create/update also rejects another supplier's established identity. Supplier names, marketplace mappings and invoice receipts appear in financial history. History only offers generic undo on the latest eligible change and excludes generated ledger entries; receipt reversals have their own workflow.

## Verification and deployment

- Full backend suite: 410 passed. Subsequent history availability change: 42 affected regressions passed.
- Full frontend suite: 135 passed. Lint and production build passed.
- Added tests: identity without cost then later cost, alias conflict/tenant checks, preview no-write and stale rejection, receipt duplicate/overpayment/reversal, generated-ledger protection, supplier alias administration, and UI confirmation/request reuse.
- Alembic chain and schema parity tests passed on disposable databases.
- Local schema upgraded to `i9a0audit0009` after SQLite backup `backend/casper.db.bak-before-connections-20261007`.
- Read-only comparison with backup: existing sku_pricing, pnl_sku_rows, purchase_bills, purchase_bill_lines, invoices and ledger_entries unchanged.
- Restarted local backend; health, frontend HTTP and newly registered OpenAPI paths verified. No fresh interactive browser walkthrough; component tests are not visual verification.

## Still open

- Inventory: asked whether P1/P2/P6 share physical stock through explicit conversions or carry separate SKU stock. No stock movements or valuation were invented before that decision.
- Full business accounting: marketplace P&L remains separate from direct-invoice accruals and general ledger operating expenses. Receipt integration does not imply that adding these totals together is correct.
- Universal or operation-group undo, stock reversal, supplier-match reversal and closed-period restatement are not implemented. Supported pricing/manual-ledger undo and receipt reversal are implemented.
- Module controls already describe navigation visibility; they do not grant/revoke API entitlements. Role/company authorization remains the API boundary.
- Marketplace mapping administration for already-costed rows is not a complete lifecycle UI; new conflicting mappings are rejected rather than silently overwriting identity.
- Browser/mobile/concurrent-writer coverage is not exhaustive. This report does not certify that every defect has been found.
