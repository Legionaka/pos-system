# TrueMarket operations guide

## Database backup and recovery

1. At opening and close, confirm the Supabase project is healthy and record the latest available backup time in the store's operations log.
2. Check the current backup coverage for the project's plan. If dashboard backups are unavailable, arrange a regular encrypted logical export with native PostgreSQL tools on a designated operator workstation and store the copy away from the project. Supabase Storage files are not included in database backups; separately export the `store-branding` and `product-images` bucket objects and keep the object list with the copy. The documented Supabase CLI `db dump` workflow requires Docker Desktop, so this project does not use that workflow.
3. Do not treat a backup as verified until a restore has been completed in a separate test project and the POS, products, sales, staff roles, and uploaded images have been checked there.
4. For a restore, choose the closest valid backup before the incident, schedule downtime, and restore into a new project first when possible. Verify data and files before redirecting the app. Restoring over the active project replaces newer database state.
5. If point-in-time recovery is being considered, review its current billing and retention configuration with the project owner first. The application does not enable or manage it.
6. Keep audit records indefinitely. Do not delete audit rows as part of normal housekeeping.

Supabase's current plan coverage and recovery steps can change; check the [Database Backups guide](https://supabase.com/docs/guides/platform/backups) and [backup and restore documentation](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) before performing a recovery. Confirm that the export covers the required application schemas and rehearse the restore before relying on it.

## Daily operating checks

- Confirm the store name and logo, products, reorder thresholds, active staff accounts, and the cashier's open shift.
- Record each delivery through **Inventory → Receive inventory**. Use the supplier name and invoice/delivery reference; do not use the stock adjustment form for normal deliveries.
- Pause checkout before starting a full-store count. Keep the pause in place until every product has been counted and the reviewed variances have been applied or the count has been cancelled.
- Review low-stock products and recent delivery/count activity at close.
- Use refunds only for approved payouts. The POS records the refund method and reference; it does not transfer funds or reverse a card transaction.

## Launch acceptance checklist

### Workstation and scanner

- [ ] Use a supported, current Chrome or Edge browser on the store workstation.
- [ ] Confirm the point-of-sale page remains usable at the workstation and tablet viewport sizes used by the store.
- [ ] Connect the USB barcode scanner as a keyboard-wedge device and verify it sends the barcode followed by Enter.
- [ ] Scan a known barcode with the POS search field focused; confirm one matching product is added once and the search clears.
- [ ] Scan an unknown barcode and confirm no unintended product is added.
- [ ] Confirm barcode values with leading zeroes match the catalog value exactly.

### Receipt printer and transaction flow

- [ ] Select the intended receipt printer as the browser's print destination.
- [ ] Complete a cash sale with a cash-rounding case; verify subtotal, VAT, rounding, total, and change on paper or print preview.
- [ ] Verify a card/EFT sale prints its method and reference without exposing unrelated customer or staff data.
- [ ] Print a partially refunded and fully refunded sale; confirm refund status, payout method, and reference are legible.
- [ ] Confirm the receipt fits the printer's roll width and has no clipped totals or controls.

### Roles and operational safety

- [ ] Verify cashier, manager, owner, and Dev sign-in destinations and restricted-route behavior.
- [ ] Confirm cashier checkout works during normal operation and is blocked during a full-store count.
- [ ] Verify only active managers and owners can receive deliveries, finish counts, or access sales reports.
- [ ] Verify Dev and cashier accounts cannot read reports, delivery costs, refunds, or product-price data.
- [ ] Verify staff deactivation blocks subsequent access and does not erase historical sales or audit events.
- [ ] Confirm the report date range, totals, VAT, refunds, cashier breakdown, and downloaded CSV agree for a known test period.

Record the test date, workstation/browser versions, scanner/printer models, tester role, and any failures before opening the store.
