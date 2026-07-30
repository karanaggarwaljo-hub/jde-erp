# Changelog

All notable changes to JDE ERP, in plain language, newest first.

## 2026-07-31 — FIFO inventory costing
- Buying the same part at a different price no longer overwrites or gets lost — each purchase is now tracked as its own priced batch, and each sale draws from the oldest unsold batch first (First In, First Out). Inventory's cost price and margin now reflect the oldest batch still in stock and update automatically as batches run out, instead of staying frozen at whatever price was set when the part was first added.
- Editing or deleting a sale now precisely un-does what it drew from those batches, rather than a rough guess.
- Manually correcting a stock count in Inventory (typing a new number) also opens or draws down a batch to match, so the batch records never drift out of sync with the actual stock count.
- The cost price shown elsewhere in the app (Reports, Analytics, Dashboard, exports, AI daily briefing) now also updates to the latest purchase price, so it stays consistent with what Inventory shows.

## 2026-07-29 — Desktop app
- Packaged the app as a real installable Windows program (its own window, Start Menu/Desktop shortcuts, uninstaller) instead of only a browser tab, using Electron. Download and install from the GitHub Releases page — no cloning code or manual setup files. First launch asks once for the Supabase connection details.
- Fixed a subtle bug where two people changing stock or a balance at almost the same moment (e.g. two computers selling the last unit of the same part) could silently overwrite each other's change. Stock and balance updates now happen atomically in the database instead of being read-then-written from the app.

## 2026-07-28 — Sales improvements
- Added full invoice editing (previously an invoice could only be viewed or deleted, not corrected).
- Added a "Payment Received" field to Sales invoices, matching how Purchases already track payments to suppliers.
- Made the GST rate on invoices manually editable instead of locked at 18%.
- Brought the Sales list up to a cleaner standard: stats row (revenue, transactions, average order value, top product, outstanding due), search, discount column, and working View/Delete actions (replacing a non-functional "Send" button).
- Removed the extra tab bar on the Sales page (Quotations still reachable via a small link).

## 2026-07-28 — Purchases rework
- Rebuilt Purchases into a one-step "Record Purchase" flow: pick or type a supplier (auto-created if new), add line items, save — stock and what you owe the supplier update immediately.
- File-import purchases (CSV/Excel/PDF/photo) now go through the same one-step flow and correctly save their line items.

## 2026-07-28 — Inventory cleanup
- Removed the Compatibility and Loc. columns from the main Inventory table to reduce clutter (the data is still there and editable — just not shown in the list view).
- Added Margin % and Status columns to the Inventory table.
- Fixed CSV import to auto-detect quantity/cost/selling-price columns and handle files with a title row above the real headers.

## 2026-07-28 — Real stock & balance tracking, reporting
- Fixed stock levels and customer/supplier balances not actually tracking real sales and purchases (they were disconnected from real transactions before this fix).
- Added Aging reports (0-30 / 31-60 / 61-90 / 90+ days) for receivables and payables.
- Added credit limit warnings.
- Removed fabricated/placeholder data from the dashboard and audit log — empty states are now honest instead of showing made-up numbers.

## 2026-07-27 — Multi-company & backend migration
- Migrated the backend to Supabase and added multi-company isolation, laying the groundwork for using this app from more than one computer.

## 2026-07-25 — 2026-07-26 — Initial build
- Initial JDE ERP application built: Next.js 16 + Supabase, core modules (Inventory, Sales, Purchases, Customers, Suppliers, Reports, and more), Gemini-powered AI features (forecasting, insights, daily briefing).
