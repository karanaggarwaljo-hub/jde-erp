# JDE ERP — Jai Durga Enterprises

An ERP web app for an auto spare parts trading business: inventory, sales, purchases, customers, suppliers, expenses, reports, and AI-assisted analytics — built for multi-company use, so you can run more than one business through the same app with fully separated data.

## Tech Stack

- **Frontend/Backend**: Next.js 16 (App Router) + React 19 + TypeScript, single Next.js server handling both UI and API routes.
- **Database**: Supabase (managed Postgres). All data access happens server-side through Next.js API routes using a service-role key — the browser never talks to Supabase directly.
- **Auth**: Supabase Auth (email/password, via `@supabase/ssr`) gates the whole app in `proxy.ts`. A valid login isn't enough on its own — it must also match an active row in `jde_users` (role: owner/manager/salesman/accountant/warehouse), which is how staff are actually granted access. See "Authentication" below.
- **AI**: Google Gemini (`@google/genai`) powers the Business Insights and Stock Reorder Forecast features on `/analytics`. These degrade gracefully (a plain error message, not a crash) if no API key is configured or the free-tier quota is exhausted.
- **Adaptive-platform integration**: a bearer-authenticated, company-scoped, read-only API projects audited inventory and purchasing data without exposing the ERP's generic table routes. New companies are available automatically from the live ERP registry. See [docs/adaptive-platform-integration.md](docs/adaptive-platform-integration.md).

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

Every business table has a `company_id` column, and exactly one company is "active" at a time (Settings → Companies). Every page reads and writes only the active company's data. Switching companies switches the entire app's view instantly — nothing is ever mixed between companies in the UI.

That's the intended behaviour; what actually enforces it is `lib/auth/dal.ts`'s `checkCompanyAccess()` / `requireOwnCompanyRow()`, called from every company-scoped API route. An `owner` may act on any company — that's the deliberate design behind the company switcher, since `jde_users` has no per-owner company membership list to check against, so "owner" is the only thing that can mean "unrestricted" here. Anyone else is confined to their own `jde_users.company_id`, checked server-side against whatever the request claims — never just trusted from a `companyId` in the request body or a bare row id. A security review found this check missing across nearly the whole API surface (any active login, any role, could act on any company's data by supplying a different id) — every route now checks; see the 2026-08-25 changelog entry for what that covered.

One caveat worth knowing: "the active company" (`jde_companies.is_active`) is a single flag shared by the whole database, not a per-browser-session value — so it assumes one person operates the app at a time, which matches how it's used today. It is not something concurrent multi-user use should rely on; a future multi-user pass would need session-scoped active-company state, not a shared table flag.

`scripts/security-audit-fixes.sql` is the database side of the 2026-08-25 fix (already applied). `scripts/company-access-check.ts` exercises `getRowCompanyId()` — the data-layer piece `requireOwnCompanyRow()` relies on — against real rows in every affected table:

```bash
npx tsx scripts/company-access-check.ts
```

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
   - `SUPABASE_SECRET_KEY` — preferred newer replacement for `SUPABASE_SERVICE_ROLE_KEY` when available; it is also server-only.
   - `ERP_INTEGRATION_TOKEN` — required only when connecting the Adaptive Skill Platform. Keep it server-side. Companies are read from `jde_companies`, so a newly created company is available to the integration immediately without changing deployment settings.
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

Google's free Gemini tier regularly runs out of quota or answers "this model is currently experiencing
high demand" under load, which used to surface as a failed AI feature. Every AI call now goes through
`lib/ai/generate.ts`, which races the configured providers and only reports an error once they have
all failed.

**Providers are started staggered, not one after the other.** The leading provider gets `AI_HEDGE_MS`
(4s by default) to work alone; if it hasn't answered by then the next one starts *alongside* it and
the first valid answer wins, with the loser cancelled. A provider that is merely slow therefore costs
seconds, not its full timeout. Racing from the very start would double the API calls on the majority
of requests that answer promptly, which these free tiers cannot spare — hence the delay.

**Requests declare what they care about** via `priority`. Short interactive asks — expense category,
part-detail suggestions, reminder drafts — pass `'speed'` and lead with the fastest provider
(`AI_FAST_ORDER`, default `groq,gemini`), which answers in well under a second. Analysis and document
work leave it at the default `'quality'` and lead with the better model (`AI_PROVIDER_ORDER`). Either
way both providers remain available, so the choice affects latency, never capability.

Beyond that:

- A rate-limit, overload, timeout or unparseable answer promotes the next provider immediately,
  without waiting out the hedge delay.
- A provider that just failed is skipped for a short cooldown (10 min after a quota error) rather
  than being re-tried on every request — unless it is the only one left.
- A malformed request stops the chain immediately, since it would fail identically everywhere.
- Providers with no key configured are skipped silently, so Gemini-only setups behave as before.
- A call abandoned because another provider won is not counted as a failure and never puts a
  healthy provider into cooldown.

Worth knowing about the Gemini side specifically: the default model is **pinned** (currently
`gemini-3.6-flash`), deliberately not Google's `gemini-flash-latest` alias. That alias always
follows Google's newest flash model, which carries the *smallest* free-tier allowance (as little as
20 requests a day) and is also the most contended — it answers 503 "experiencing high demand" under
load while a pinned version of the same family answers normally. Both of those have taken the AI
features down in production. `GEMINI_MODEL` still overrides the pin; see `.env.example`.

### How often the AI actually runs

The three expensive AI panels — Business Insights, Stock Reorder Recommendation and the report
summaries — do **not** regenerate on every page load. Each one is allowed `DAILY_ALLOWANCE`
(currently 2) real provider calls per company per day; every other request replays the stored
answer out of `jde_ai_cache`. Report summaries count per report tab, since each tab is a different
question. See `lib/ai/cache.ts`.

Why: the free tiers here are small (Gemini's newest models allow as few as 20 requests a day, Groq
caps tokens per minute), and before this, idle browsing consumed the same allowance the owner needed
when they actually wanted an answer — five report tabs meant five generations just to look around.

Rules worth knowing before changing it:

- An automatic page load never spends a run unless nothing is stored yet, or the stored answer is
  older than `REFRESH_AFTER_HOURS` (12), which spaces the day's two runs out.
- Pressing **Refresh** spends a run deliberately — but cannot exceed the daily allowance.
- A failed generation costs nothing: the counter only advances on success, and the last good answer
  is shown with a note rather than being replaced by an error.
- Every replayed answer carries the time it was really produced. The panels display that, never the
  browser's own clock — otherwise a stored answer would appear to have been generated just now.
- Report summaries additionally store a fingerprint of the figures they describe. If the numbers
  move, the summary is not shown as though it described the new ones.

Verify the whole thing against the real database, without spending any AI calls:

```bash
npx tsx scripts/ai-cache-check.ts
```

It runs the real cache code under a reserved feature key, asserts the allowance actually holds
(including that a forced refresh cannot exceed it), and deletes everything it created.

Not everything can fail over. Gemini remains the only provider here that reads PDFs, does Google
Search grounding (Website Catalog → Reference Search) or generates images, so those three keep their
existing behaviour of failing safely with a message. Invoice scans of *images* do fall back to Groq.

To verify the chain end to end, including a forced failure:

```bash
npx tsx scripts/ai-fallback-check.ts
```

### Matching imported invoice lines to inventory

`lib/import-matching.ts` decides whether a line on an imported invoice restocks a part already on
file or creates a new one. It is deliberately a separate, dependency-free module rather than page
code: this is where a mistake costs real money, and being pure is what lets
`scripts/import-matching-check.ts` exercise it directly.

The order is: identifiers, then exact text, then — only as a *suggestion* — word similarity.

- Part number and OEM number are compared **both ways** (line part ↔ product OEM and vice versa),
  because suppliers routinely print an OEM code in their own "part no" column. An identifier hit is
  an `exact` match and is acted on unattended.
- Auto-generated `SP-###` part numbers are treated as placeholders, never as identifiers — the app
  invented them, so they prove nothing and may be overwritten by a real one.
- A name-similarity hit (Dice coefficient over words, ≥ 0.55) is only ever `suggested`. The review
  screen asks the owner, and the purchase cannot be recorded while a suggestion is undecided.
  Auto-linking here was rejected deliberately: wrongly merging two parts moves stock and cost onto
  the wrong record, which is far more expensive than a click.

`planFieldUpdates()` then decides what the invoice may teach an existing part: blank fields (and
placeholder part numbers, and a zero cost) are filled in; anything already entered is left alone and
any disagreement is surfaced in the review screen instead of applied. Enrichment runs *after* the
purchase is safely recorded and never fails it — a part keeping a blank brand is cosmetic, undoing a
recorded purchase is not.

```bash
npx tsx scripts/import-matching-check.ts
```

### Printing an invoice or quotation

`app/(dashboard)/sales/invoice/[id]/page.tsx` and `app/(dashboard)/sales/quotation/[id]/page.tsx`
are formatted, letterhead documents (company name/GSTIN/address, bill-to, line items, GST
breakdown, balance due or quotation total) with a Print/Save-as-PDF button — reached from the Print
icon on any invoice/quotation row or their View modals. Both live inside `(dashboard)` (to reuse
`CompanyProvider`), and hide the sidebar/topbar only when actually printing, via `@media print`
rules in `globals.css` shared by both. The invoice page reads already-loaded table rows (an
invoice's line items are in the same `useCompanyTable` cache every other Sales view shares); the
quotation page fetches fresh from `GET /api/sales/quotation` instead, since a quotation's items
live in a table nothing else on that route loads and quotations are only ever looked up one at a
time. `lib/client-export.ts`'s `printCurrentPage()` (a plain `window.print()`) is still exactly
right for Reports, which genuinely wants the whole page printed — it's deliberately not used for
either of these, where printing the surrounding dashboard chrome would be the bug being fixed.

### Receiving a customer payment

A customer who buys on credit across several days and pays the running total in one visit needs
that payment recorded as its own event, applied across the specific invoices it settles — not each
invoice hand-edited with nothing left to show a payment ever happened. `jde_receive_customer_payment`
(`scripts/customer-payments.sql`) does this atomically: the payment row, its per-invoice
allocations, each invoice's paid/status, and the customer's balance land together, or not at all.

The owner chooses which invoices a payment applies to (`components/ReceivePaymentModal.tsx`, used
from both the Sales page and the Customers page) — a "Fill oldest first" button gives a starting
point, still fully editable. The amounts entered must add up to exactly the payment amount; nothing
is left as an unexplained credit. The Sales page's Customer Ledger tab
(`lib/customer-ledger.ts`) then shows one customer's invoices and payments together, in order, with
a running balance — reversing a payment (for one entered wrong, not a refund) puts every invoice it
touched back to how it was.

An invoice with a payment already recorded against it can no longer be deleted directly —
`jde_delete_sales_invoice` refuses with a message to reverse the payment first, so a payment
allocation can never point at a row that no longer exists.

`payments_received`/`payment_allocations` are read-only through the generic `/api/local/[table]`
routes (writing there would bypass the balance/status bookkeeping) — recording or reversing a
payment always goes through `/api/sales/payments`.

```bash
npx tsx scripts/customer-ledger-check.ts
```

### Sitemap and robots.txt

`app/sitemap.ts` and `app/robots.ts` use Next.js's built-in conventions to serve `/sitemap.xml` and
`/robots.txt`. Both list only the Website Catalog (`/catalog` and each published product) — the one
public surface this app has (see `PUBLIC_PREFIXES` in `proxy.ts`) — never any dashboard route.

Getting this right needed a change in two places, not one: the routes themselves, and `proxy.ts`'s
`PUBLIC_EXACT` allowlist. Without the latter, an unauthenticated crawler requesting either path was
redirected to `/login` like any other page — a real page, but an HTML one, which is exactly what
produces Search Console's "Sitemap is HTML" error. Both files fall back to
`https://jd-enterprise.com` (matching the CORS allowlist already hardcoded in
`app/api/public/catalog/route.ts`) when `NEXT_PUBLIC_SITE_URL` isn't set, so a missing env var can't
silently produce a sitemap full of `localhost` URLs.

### Customer segmentation

`lib/customer-insights.ts` grades customers Diamond / Gold / Silver (or New) and attaches
Defaulter / Bargainer / Dormant flags. Pure and dependency-free for the same reason as
`lib/import-matching.ts` — it decides who gets an offer and whose credit gets tightened, so it is
exercised directly by `scripts/customer-insights-check.ts` rather than only through the UI.

Two design points worth keeping:

- **Tiers are cut from cumulative gross profit, not revenue** (classic ABC analysis, three bands).
  Diamond is "the customers who between them earn the first 50% of your profit" — a statement about
  the business, rather than a rupee threshold that ages badly. Profit is real, not estimated: line
  totals minus the actual FIFO cost drawn for them via `jde_stock_consumptions`. On this app's own
  data revenue and profit rank customers in *opposite* orders, which is the whole justification.
- **Tier and flags are independent.** A Diamond customer can also be a Defaulter — that combination
  ("buys the most, pays the worst") is the single most useful thing on the screen and a single flat
  label would hide it.

Grades are recomputed from live rows on every render rather than stored, so a grade can never go
stale against the sales it was derived from. Anything below `INSIGHT_RULES.minOrdersToGrade` sales
returns `new` with a reason, never a guessed tier. All thresholds live in `INSIGHT_RULES` — they are
defensible starting points, not values tuned against real trading history, which does not exist yet.

```bash
npx tsx scripts/customer-insights-check.ts
```

The live half of that script prints the real grades per company, which is the quickest way to sanity-check the rules against the actual business.

**Drafting an offer** (`app/api/ai-draft-offer`, `components/SegmentOfferModal.tsx`) deliberately splits the commercial decision from the wording: the owner types the terms, the model only words them for that customer. A model inventing "15% off this week" would be writing a commitment the owner is bound to honour once it is sent — so the prompt forbids stating any percentage, price, product, quantity or deadline not present in the given terms, and a vague offer must stay vague rather than being filled out with invented specifics. The internal grade is never repeated back to the customer either; it only selects the angle. The segment guidance shown above the input comes from the hardcoded `TIER_ACTIONS`/`FLAG_ACTIONS`, not from a model, so advice on what kind of offer suits a group is stable and reviewable.

```bash
npx tsx scripts/offer-draft-check.ts
```

That one calls a real provider, so it costs a few requests and its output is not deterministic — the assertions are about what must never appear (an invented number, the tier word) rather than exact wording.

### Stock integrity

`products.current_stock` is a denormalized figure — the real, audited stock is the sum of a
product's own `jde_stock_layers.qty_remaining` rows (its actual purchase batches). Every code path
that should touch stock (`jde_consume_stock_fifo`, `jde_add_stock_layer`,
`jde_restore_stock_layers_for_invoice_item`) keeps both in step atomically; nothing in the current
app calls `jde_adjust_product_stock` (the one function that only touches `current_stock`) for
products. If the two ever disagree, it's data damage from something outside those paths — a prior
version of the code, or a direct database edit — not something the app can cause on its own today.

```bash
npx tsx scripts/stock-integrity-check.ts
```

### Backups

A JSON snapshot of every table is saved to the private `jde-backups` Supabase Storage bucket once per day (and on-demand from Settings → Data Backups, where each snapshot can also be downloaded). Snapshots older than 7 days are pruned automatically. This is a secondary safety net in addition to whatever backup/PITR your Supabase plan provides — it never touches your live data.

The daily run is triggered by **Vercel Cron**, configured in `vercel.json`, which calls `/api/cron/backup` once a day. A cron request carries no browser session, so `/api/cron` is a `SERVICE_AUTH_PREFIXES` entry in `proxy.ts` — it bypasses the Supabase-cookie gate and authenticates itself instead:

- It uses the **same `CRON_SECRET`** as the adaptive-platform reconciliation job, which is the Vercel convention (one secret, sent as `Authorization: Bearer <CRON_SECRET>` on every cron invocation). If that job is already running in production, this one needs no new configuration.
- The secret must be at least 32 characters, matching the reconciliation route's floor. Unset or shorter, the route refuses everyone including the cron — it fails closed rather than leaving a read of every table open.

Note that Vercel's free plan allows **two** cron jobs, which is exactly what `vercel.json` now declares; a third would need a plan change. Free-plan crons also fire once within the scheduled hour rather than at an exact minute, which is immaterial for a nightly snapshot.

Running outside Vercel (local `npm run dev`, or a self-hosted server) means no cron trigger: use **Backup Now** in Settings → Data Backups, or call `/api/cron/backup` from any scheduler with the same bearer header.

## License & Ownership

Developed for **Jai Durga Enterprises**. All rights reserved.
Product Owner: **Karan Aggarwal**
