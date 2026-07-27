# JDE ERP — Jai Durga Enterprises

An ERP web app for an auto spare parts trading business: inventory, sales, purchases, customers, suppliers, expenses, reports, and AI-assisted analytics — built for multi-company use, so you can run more than one business through the same app with fully separated data.

## Tech Stack

- **Frontend/Backend**: Next.js 16 (App Router) + React 19 + TypeScript, single Next.js server handling both UI and API routes.
- **Database**: Supabase (managed Postgres). All data access happens server-side through Next.js API routes using a service-role key — the browser never talks to Supabase directly, and there's no user-facing auth layer today.
- **AI**: Google Gemini (`@google/genai`) powers the Business Insights, Stock Reorder Forecast, and Daily Briefing features on `/dashboard` and `/analytics`. These degrade gracefully (a plain error message, not a crash) if no API key is configured or the free-tier quota is exhausted.

## Modules

| Module | Route | What it does |
|---|---|---|
| Executive Dashboard | `/dashboard` | Real per-company KPIs (sales, purchases, receivables, payables, low stock), a sales-vs-purchases chart, and a recent activity feed — all computed live from your data, not sample numbers. |
| Spare Parts Inventory | `/inventory` | Catalog with part number, OEM number, brand, category, pricing, stock levels. Supports bulk import from a CSV/Excel file with flexible column-header matching. |
| Sales | `/sales` | Quotations and invoices against your real customer and inventory data. |
| Purchases | `/purchases` | Purchase orders and goods-received notes, with CSV/Excel/PDF/photo import (Gemini extracts line items from scanned documents). |
| Customers / Suppliers | `/customers`, `/suppliers` | Directories with credit limits, GSTIN, and outstanding balances. |
| Expenses | `/expenses` | Operational expense log by category. |
| Reports | `/reports` | P&L, sales summary, stock valuation, and a GST summary (assumes 18% inclusive tax unless your figures say otherwise). |
| Analytics | `/analytics` | AI-generated business insights and reorder recommendations, plus real stock-value rankings. |
| Settings | `/settings` | Company management (create/switch/delete companies — each company's data is fully isolated), user roles, and local backup snapshots. |

## Multi-Company Data Isolation

Every business table has a `company_id` column, and exactly one company is "active" at a time (Settings → Companies). Every page reads and writes only the active company's data. Switching companies switches the entire app's view instantly — nothing is ever mixed between companies.

## Setup

### Prerequisites

- Node.js 20 or newer
- A Supabase project (the schema below assumes one already exists with the `jde_*` tables created — see "Database schema" below if starting from scratch)

### Steps

1. **Get the code onto the machine** — copy the project folder, or `git clone` if it's in a repo.

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables** — copy `.env.example` to `.env.local` and fill in real values:
   ```bash
   cp .env.example .env.local
   ```
   - `NEXT_PUBLIC_SUPABASE_URL` — your Supabase project URL.
   - `SUPABASE_SERVICE_ROLE_KEY` — from Supabase dashboard → Project Settings → API → `service_role` secret. **Never commit this or expose it to the browser.**
   - `GEMINI_API_KEY` — optional, only needed for the AI features. Get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

4. **Run it**:
   ```bash
   npm run dev        # development
   # or
   npm run build && npm run start   # production
   ```
   Open [http://localhost:3000](http://localhost:3000).

### Running on a second computer

Since all data lives in Supabase (not a local file), there's nothing to copy or sync — just repeat the setup steps above on the other machine using the **same** `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` values, and it will see the exact same companies and data. Each computer runs its own copy of the Next.js server; they all read/write the same Supabase project.

### Database schema

The app expects these tables in your Supabase project's `public` schema, all prefixed `jde_`: `companies`, `products`, `customers`, `suppliers`, `invoices`, `quotations`, `purchase_orders`, `grns`, `expenses`, `users` — plus two RPC functions, `jde_activate_company` and `jde_delete_company`, used for atomic company-switch/delete operations. Row-level security is enabled on every table with no policies, so only the service-role key (used server-side only) can access the data.

### Backups

A JSON snapshot of every table is saved to `data/backups/` once per day automatically while the app is running (and on-demand from Settings → Data Backups). Snapshots older than 7 days are pruned automatically. This is a local safety net in addition to whatever backup/PITR your Supabase plan provides — it never touches your live data.

## License & Ownership

Developed for **Jai Durga Enterprises**. All rights reserved.
Product Owner: **Karan Aggarwal**
