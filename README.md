# JDE ERP — Jai Durga Enterprises

An ERP web app for an auto spare parts trading business: inventory, sales, purchases, customers, suppliers, expenses, reports, and AI-assisted analytics — built for multi-company use, so you can run more than one business through the same app with fully separated data.

## Tech Stack

- **Frontend/Backend**: Next.js 16 (App Router) + React 19 + TypeScript, single Next.js server handling both UI and API routes.
- **Database**: Supabase (managed Postgres). All data access happens server-side through Next.js API routes using a service-role key — the browser never talks to Supabase directly.
- **Auth**: Supabase Auth (email/password, via `@supabase/ssr`) gates the whole app in `proxy.ts`. A valid login isn't enough on its own — it must also match an active row in `jde_users` (role: owner/manager/salesman/accountant/warehouse), which is how staff are actually granted access. See "Authentication" below.
- **AI**: Google Gemini (`@google/genai`) powers the Business Insights and Stock Reorder Forecast features on `/analytics`. These degrade gracefully (a plain error message, not a crash) if no API key is configured or the free-tier quota is exhausted.

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
| Settings | `/settings` | **Owner only.** Company management (create/switch/delete companies — each company's data is fully isolated), inviting/managing user roles, and local backup snapshots. |

## Multi-Company Data Isolation

Every business table has a `company_id` column, and exactly one company is "active" at a time (Settings → Companies). Every page reads and writes only the active company's data. Switching companies switches the entire app's view instantly — nothing is ever mixed between companies.

## Authentication

Every page and API route requires a real, signed-in staff account — enforced centrally in `proxy.ts` (Next.js 16's renamed `middleware.ts`), not just hidden in the UI. Two layers:

- **Authentication** — Supabase Auth (email/password). No public signup; accounts exist only by invite.
- **Authorization** — a matching `jde_users` row with `status = 'active'`. A valid Supabase login alone isn't enough — this is what stops anyone else who might have a login on the same Supabase project (e.g. if it's ever shared with another app) from getting into this one.

**Roles**: `owner`, `manager`, `salesman`, `accountant`, `warehouse` — set per user in Settings → User Roles & Access. Only `owner` can reach `/settings` itself (company management, deleting a company, inviting/editing other users' roles); every other role currently sees the same rest of the app. Finer per-role restrictions may come later.

**Inviting a teammate** (Settings → User Roles & Access → Invite User, owner only): sends a real Supabase invite email. They click it, land on `/accept-invite`, set their own password, and are active from then on. "Forgot password" isn't self-service yet — reset it for them directly in Supabase Dashboard → Authentication → Users.

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
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from Supabase dashboard → Project Settings → API → the `anon public` (or newer `publishable`) key. Safe to expose to the browser — it's what your own sign-in page uses.
   - `SUPABASE_SERVICE_ROLE_KEY` — from Supabase dashboard → Project Settings → API → `service_role` secret. **Never commit this or expose it to the browser.**
   - `GEMINI_API_KEY` — optional, only needed for the AI features. Get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
   - `GROQ_API_KEY` — optional but recommended. The backup AI provider: when Gemini is rate-limited or overloaded, the AI features automatically retry on Groq instead of failing. Free, no card, from [console.groq.com](https://console.groq.com) → API Keys. See "AI provider fallback" below.

4. **Create the first owner account** — a valid Supabase Auth login isn't enough by itself; it also needs a matching `jde_users` row, and there's no signup form (accounts are created by invite — see "Authentication" below). For the very first account on a fresh project, create both halves manually once: add a user under Supabase Dashboard → Authentication → Users (or reuse one that's already there), then insert their `jde_users` row:
   ```sql
   insert into jde_users (email, company_id, name, role, status)
   values ('you@example.com', '<a company id from jde_companies>', 'Your Name', 'owner', 'active');
   ```

5. **Run it**:
   ```bash
   npm run dev        # development
   # or
   npm run build && npm run start   # production
   ```
   Open [http://localhost:3000](http://localhost:3000) and sign in.

### Running on a second computer

Since all data lives in Supabase (not a local file), there's nothing to copy or sync — just repeat the setup steps above on the other machine using the **same** `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` values, and it will see the exact same companies and data. Each computer runs its own copy of the Next.js server; they all read/write the same Supabase project.

### Database schema

The app expects these tables in your Supabase project's `public` schema, all prefixed `jde_`: `companies`, `products`, `customers`, `suppliers`, `invoices`, `quotations`, `purchase_orders`, `grns`, `expenses`, `users` — plus two RPC functions, `jde_activate_company` and `jde_delete_company`, used for atomic company-switch/delete operations. Row-level security is enabled on every table with no policies, so only the service-role key (used server-side only) can access the data.

### AI provider fallback

Google's free Gemini tier regularly answers "this model is currently experiencing high demand" under
load, which used to surface as a failed AI feature. Every AI call now goes through `lib/ai/generate.ts`,
which tries each configured provider in order (default `gemini,groq`) and only reports an error once
they have all failed.

- A rate-limit, overload, timeout or unparseable answer moves to the next provider; a genuinely
  transient failure is retried once on the same provider first.
- A provider that just failed is skipped for a short cooldown (10 min after a quota error) rather
  than being re-tried on every request — unless it is the only one left.
- A malformed request stops the chain immediately, since it would fail identically everywhere.
- Providers with no key configured are skipped silently, so Gemini-only setups behave as before.

Not everything can fail over. Gemini remains the only provider here that reads PDFs, does Google
Search grounding (Website Catalog → Reference Search) or generates images, so those three keep their
existing behaviour of failing safely with a message. Invoice scans of *images* do fall back to Groq.

To verify the chain end to end, including a forced failure:

```bash
npx tsx scripts/ai-fallback-check.ts
```

### Backups

A JSON snapshot of every table is saved to `data/backups/` once per day automatically while the app is running (and on-demand from Settings → Data Backups). Snapshots older than 7 days are pruned automatically. This is a local safety net in addition to whatever backup/PITR your Supabase plan provides — it never touches your live data.

## License & Ownership

Developed for **Jai Durga Enterprises**. All rights reserved.
Product Owner: **Karan Aggarwal**
