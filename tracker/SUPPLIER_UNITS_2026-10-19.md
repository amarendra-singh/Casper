# Supplier unit and bill cost update — 19 October 2026

Implemented explicit supplier unit (piece/box/set), pieces per unit, quantity display, and persisted conversion editing. Existing unknown values remain null. Single-piece units require exactly one piece. Reuploads retain unambiguous saved unit conversions. SKU pack size remains explicitly configured in the catalogue.

Bill view calculates supplier rate / pieces per supplier unit * pieces per SKU. All platform costs are displayed; differences are suppressed when platform costs conflict. Legacy conversions remain visible for existing records. The bill cost action now opens catalogue approval with the source line selected; approval requires explicit supplier units and a physical stock mapping. The existing preview/apply flow updates linked variant/platform pricing and retains frozen report snapshots. Already approved bill conversions cannot be silently edited.

Supplier matching search includes saved marketplace aliases. No alias was invented for MBG-WG-ROTA-300-ZZB-1B; its identity remains unresolved. The LZB-D to ZZB-C-P1 mapping requires user review.

Validation: 21 targeted backend tests and 136 frontend tests passed, frontend lint/build and targeted Ruff passed. Migration k1b0units0011 applied after SQLite backup. Backend health and new route registration checked. Authenticated visual verification remains incomplete: Tabbit registration unavailable; in-app browser opens at login.


## Simplified table supersedes supplier-unit controls
User confirmed Price = Amount / Quantity. The bill table now edits Date, Ref, Item, Quantity, Price and Amount, retains searchable Matched SKU and recorded-cost review, and removes unit/conversion controls. Editing Price updates Amount; Amount or Quantity updates Price. Explicit Save row persists the source line, marks quantity as sellable items, updates bill totals by the line amount delta, and synchronizes the linked ledger. Date/Ref changes apply to the parent bill. Recorded SKU costs require separate review. Existing data is not bulk rewritten.
