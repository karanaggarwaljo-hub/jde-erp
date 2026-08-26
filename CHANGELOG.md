# Changelog

All notable changes to JDE ERP, in plain language, newest first.

## 2026-08-26 — Fixed: the daily backup had not run once since the site went online

Your live data was never in danger — Supabase holds the real thing, and nothing here touches it.
What had stopped working was the spare copy.

**What was wrong.** The app tried to save each day's snapshot into a folder on the machine it was
running on. That was right when the ERP ran from a computer in the office, but the live site does
not work that way — it has no folder of its own to write to, and keeps nothing between one visit
and the next. So every attempt failed the moment it started, about once an hour, filling the server
log with the same error each time. There has been no snapshot at all since the app moved to
erp.jd-enterprise.com.

**Where backups go now.** Into a private storage area inside your own Supabase account, next to
where the website catalogue photos already live. Private, not public: checked directly, the file
cannot be opened by anyone who hasn't gone through the ERP signed in as owner.

**When they happen now.** Once a night, around 1:30am, run by a real scheduler instead of by the
app noticing the time while somebody happens to have it open — which is the part that could never
have worked on a live site. Snapshots older than 7 days are still cleared out automatically.

**You can now download a backup.** When these files sat on a hard drive you could always go and
find one; now that they're in the cloud, each row in Settings → Data Backups has a Download button
that saves it to your computer. Worth doing occasionally — a copy on your own machine is the only
one that would survive losing the Supabase account itself.

**Also fixed while in there:**

- **The snapshot was close to silently losing data.** It asked for every row of every table in one
  go, and Supabase quietly stops answering at 1,000 rows. Your parts list is at 934. Another 66
  parts and every backup would have been cut short while still looking complete. It now reads
  everything in batches, however large a table gets. Checked row for row against the live database
  afterwards: all 19 tables match exactly.
- **Any member of staff could have downloaded all of your data.** The Settings screen was owner-only,
  but the web address behind it wasn't — anyone with a working login could have pulled a full copy
  of every company's records straight from it. Now owner-only, matching the screen.
- **A backup now takes 4 seconds instead of 14**, because it reads all the tables at the same time
  rather than one after another. Beyond being quicker, it means the snapshot is taken across a
  narrower moment, so a sale recorded midway through is less likely to be caught half in, half out.
- **The repeating error in the server log is gone**, because the thing producing it no longer exists.
- **The desktop version's local backup folder was removed**, since you confirmed everyone works from
  the website now. One place backups live, one way they're made.

**One thing to do at your end.** In Vercel, add a setting called `CRON_SECRET` with any long random
value, then redeploy. That's the password the nightly scheduler uses to prove it really is the
scheduler. Until it's set the nightly run refuses to start — deliberately, because that address can
read your entire database, and doing nothing is safer than being left open. "Backup Now" in Settings
works either way.

## 2026-08-26 — Fixed (properly): the AI Stock Reorder Recommendation was sending your whole catalogue

The earlier fix today got the message honest and the model pinned, but the feature still failed —
so this went back to the live server logs and found the actual reason, which was something else
entirely.

**Every time you asked for a reorder recommendation, the app sent all 242 of your parts to the AI.**
Both AI services refused it, for two different reasons: the backup service rejected the request
outright as too large (it allows 8,000 units of text a minute; this was 9,738), and Google's took
longer than the app was willing to wait and got cut off. Neither failure had anything to do with
your data or your keys.

None of that bulk could ever change the answer. The recommendation only ever names up to 8 parts,
and it decides purely by comparing stock on hand against each part's reorder level — so a part
sitting comfortably in stock cannot possibly be recommended, no matter how many of them get sent.
The app now sends only the parts that could genuinely need reordering: anything out of stock, or
within 1.5x of its reorder level. For your active company that is 18 parts instead of 242 — a 93%
smaller request. It still tells the AI the true size of the full catalogue and how many parts were
left out as well-stocked, so a short list can never be mistaken for a small business.

Checked against real data, end to end: the backup service now answers in 1.7 seconds using 1,202
units of text, comfortably inside its limit, and returns a real recommendation ("Hydraulic Pump
HYD-P01 — stock 1, order 1, high urgency").

**Also fixed while in there:**

- **The app was cutting the AI off too early.** Google's model genuinely needs about 16 seconds to
  think through a reorder list; the app gave up at 14 and reported "the AI service could not be
  reached" with nothing actually wrong. Raised to 25 seconds. You will not notice the wait — the
  backup service starts alongside after a few seconds and normally answers first; the longer
  allowance only matters on the occasions when it is the only one left.
- **The card claimed something it doesn't do.** It said recommendations were "based on current
  stock levels and 60-day sales velocity". The sales-velocity part was never true — the feature has
  never had that data and the code says so explicitly. It now says what it actually uses.

**Separately, and not fixed here:** the hourly backup is failing on every run on the live site
(it tries to write to a folder that doesn't exist on a hosted server). Your data is safe — Supabase
is the real store — but the extra safety net has not been running since the site went online. Worth
its own piece of work.

## 2026-08-26 — Fixed: all the AI features failing at once, and an error message that lied

Reported: AI Summary, AI Stock Reorder Recommendation and AI Business Insights all showed
"The ERP is temporarily unavailable. Your action was not saved" at the same time. Two separate
problems, neither of them a fault in the ERP itself.

**Why they failed.** The app asked Google for `gemini-flash-latest`, which is not a model but a
shortcut meaning "whatever your newest one is". Google's newest model is also its busiest, and it
was turning everyone away with "experiencing high demand". Checked directly: that shortcut was
refusing every request, while a specific named version of the same Google model answered normally
in the same second. The app now asks for the specific version by name. That shortcut was also the
reason for the earlier round of AI failures — it carries the smallest free daily allowance of any
Google model — so this closes both, and means the app's behaviour can no longer change on its own
without anything being deployed.

**Why the message was wrong.** Whenever a request failed, the screen replaced the real explanation
with one blanket sentence, including the words "your action was not saved". For a summary or a
recommendation that is simply untrue — nothing was being saved, you were only reading. So the
message raised alarm about something that never happened while hiding the one detail that would
have explained the failure. Now, when a service the ERP depends on is genuinely unavailable or at
its usage limit, you get told that in plain words instead. Unexpected faults still get one calm
sentence, but it no longer claims anything about what was or wasn't saved.

**Still worth doing, and it needs your Vercel login, not mine:** a backup AI service (Groq) is
already built in and its key already works, but that key was only ever added to the development
machine, never to the live site — which is why nothing covered for Google when it went down. Adding
`GROQ_API_KEY` in Vercel's environment variables means a repeat of today is invisible to you.

## 2026-08-25 — Fixed: wrong stock numbers showing in Inventory, and a gap in editing a sale

Reported: recording or editing a sale sometimes didn't seem to record, and the stock numbers shown
afterward looked wrong. What was actually happening: 5 parts (across both companies) had their
displayed stock quietly drift away from the real, audited stock on record — two badly (one showed
1 in stock when 19 were really there; another showed 0 when 7 were really there). The sale itself
was recording correctly; it was the Stock Level column that had gone stale, from historical data,
not anything happening right now. All 5 corrected to match the real stock on record, and every
other part checked against its actual purchase history — nothing else was wrong.

While tracking this down, found and fixed a real gap: editing an existing sale checked nothing
about which company that invoice actually belonged to. Same class of issue as the ones closed in
yesterday's security audit, in the one function every sale actually goes through — missed there,
caught here. Fixed the same way, and checked (with real data, undone immediately after) that a
correct edit still works exactly as before and a wrong-company one is now refused.

Added `scripts/stock-integrity-check.ts`, which checks every part's displayed stock against its
real purchase-batch history and lists anything that doesn't match — so if this ever happens again,
it's a one-command check instead of a manual investigation.

## 2026-08-25 — Security audit: closed a public data-exposure hole and a company data-isolation gap

A full security and functional review of the app. Two things stand out — everything else here is
smaller.

**A live, unauthenticated hole in the Website Catalog switch.** Anyone on the internet — no login
needed — could send one request directly to the database and change which company's catalogue your
public website shows, or knock it offline. Confirmed exploitable before the fix, and fixed the same
way: that ability now only exists for the ERP itself, not for outside visitors.

**Company data wasn't actually being kept apart.** This ERP holds three companies' data in one
place, and staff accounts are meant to only ever see their own company's — but very little of the
app actually checked that. A logged-in salesperson, warehouse, or accountant account (any role
below owner) could read, edit, or delete another company's products, customers, invoices, or stock
by supplying that company's id instead of their own — or, in a few places, just by asking for a
record by its number, with no company check at all. Right now only one person (the owner) has a
login, so nothing has actually been exposed yet — but this needed fixing before any staff member is
invited, not after. Every place this was found now checks the logged-in person's own company first;
the owner can still move between all three companies, exactly as the company switcher already lets
them do.

Alongside that: deleting an invoice used to trust a number computed in the browser for how much to
reverse off the customer's balance, rather than checking the invoice's real amount itself — fixed to
compute it from the invoice, same principle as the sales-return fix a few days ago.

**Also found and fixed, from a full read of the client-side pages:**

- Recording a supplier payment had no protection against a double-click — two clicks could subtract
  the paid amount from the payable balance twice while only one payment actually happened. Now
  guarded, and a failure partway through is shown instead of silently leaving things half-updated.
- Marking a purchase order "Received" had the same double-click gap, risking stock being added
  twice for one delivery. Now guarded.
- Deleting an inventory part showed nothing at all if the delete failed — the confirmation box just
  sat there with no explanation. Now shows the real reason and can be retried or cancelled cleanly.
- Cost Price, MRP, and Sale Price in Inventory could be saved as negative numbers; Expense amounts
  could be saved as negative or zero. Both now blocked, matching every other price field in the app.

**Also found, deliberately not touched yet:** four leftover test rows in one internal table
(invoice line items pointing at invoice numbers that don't exist) — harmless, invisible to the app,
but real cleanup worth doing at some point. And the flow for editing a sales invoice while switching
which company you're working in mid-edit could, in an unusual sequence, apply a balance change to
the wrong customer — flagged for a closer look rather than rushed into this pass.

## 2026-08-24 — Fixed: Google Search Console "Sitemap is HTML" error

The website had no sitemap at all — the app never had that page — so when Google requested
`/sitemap.xml` it got redirected to the login page and reported "Sitemap is HTML."

Added a real sitemap listing the Website Catalog and every published product, plus a `robots.txt`
that tells search engines to leave the private dashboard alone and only look at the catalog. Also
had to add both to the list of pages reachable without logging in — otherwise a search engine
would still get redirected to the login page instead of the sitemap itself, even with the page now
existing. Should clear the Search Console error within a few days of Google re-checking it.

## 2026-08-24 — Fixed: Quotation's Print button had the same bug as Invoice's did

Yesterday's invoice fix (below) left one sibling untouched on purpose: the Quotation view's Print
button, and the Print icon on each quotation row, had the exact same problem — printing the whole
dashboard screen instead of the quotation. Both now open a real, formatted quotation document —
your business letterhead, the customer, every line item, GST breakdown, quotation total, and a
clear "this is a quotation, not a tax invoice" note — with the same Print / Save as PDF button the
invoice page has.

## 2026-08-24 — Printable invoices, and recording a customer's payment across several purchases

Two things Sales couldn't do until now.

**A real invoice document.** Every invoice's "Print" button used to just print whatever was on
screen — the whole dashboard, sidebar and all — not the invoice itself. Clicking Print (on an
invoice row, or from View Invoice) now opens a proper formatted invoice: your business name,
address and GSTIN at the top, the customer's details, every line item, the GST breakdown, and the
balance due — with a Print / Save as PDF button, ready to hand to a customer or email as a PDF.

**Recording a payment that covers several purchases at once.** If a customer buys on credit across
a few separate days and then pays the running total in one visit, that's now one action: **Receive
Payment**, on Sales and on Customers. Pick the customer, enter what they paid, and choose which of
their open invoices it covers — a "Fill oldest first" button gives you a starting point, but you
stay in control of exactly where the money goes. Every rupee has to land on a real invoice; nothing
is left as an unexplained credit.

This replaces how the Customers page used to "record" a payment — it used to just rewrite invoice
and balance numbers directly, with nothing recording that a payment had actually happened, and no
protection if a step failed partway through. A payment is now its own record, with a receipt number,
and Sales has a new **Customer Ledger** tab showing one customer's invoices and payments together in
order, with a running balance — which is the direct answer to "did they ever pay me back for all
three of those." A payment entered wrong can be reversed, which puts its invoices back exactly as
they were; a payment already recorded against an invoice now blocks that invoice from being deleted
until the payment itself is dealt with first, so the two can never end up disagreeing with each other.

## 2026-08-23 — Fixed: sales returns could never be recorded

Every attempt to record a sales return failed with "The ERP is temporarily unavailable". It wasn't a
temporary problem and it wasn't your connection: the database routine that records a return had a
naming clash in it, so the database refused the very first step, every time, for every invoice.
Nothing was ever half-saved — the return simply didn't happen.

The routine is fixed. **This one needs the database script to be run** (`scripts/fix-sales-return-ambiguous-id.sql`)
— updating the app alone does not fix it.

Two related improvements, so this kind of thing surfaces instead of hiding:

- When the database rejects something for a real business reason — "return quantity exceeds the
  remaining quantity", "the customer does not match this invoice" — you now see that actual
  sentence. Until now every one of those was replaced with the generic "temporarily unavailable"
  message, which told you nothing about what to change. Applies to sales returns, supplier returns,
  recording and receiving purchases, and quotations.
- When something genuinely does break, the real reason is now written to the browser console.
  Previously it was discarded entirely, which is why this bug went unnoticed.

## 2026-08-23 — Invoices now recognise parts you already stock, and fill in what's missing

Until now, an imported invoice only recognised an existing part if the wording matched almost
exactly. So when a supplier billed the same physical part under their own name, the app quietly
created a **second** part, put the stock there, and left your original sitting at zero. Two records,
one real part.

Three things change:

**The scanner now reads the identifiers.** Part number, OEM number, brand and HSN code are pulled
off each line of the invoice, where before only the description, quantity and price were read.

**Matching uses those identifiers first.** If the invoice prints a part number you already have on
file, it restocks that part — no matter what the supplier chose to call it. It also cross-checks:
suppliers often print an OEM number in their own "part no" column, so both are compared both ways.

**Where the name only looks similar, you decide.** The review screen shows "Same part?" with the
existing part, its current stock, and buttons for **Same part** / **Different part**. Nothing is
linked on a guess — attaching stock to the wrong part is much harder to unpick than one click — and
the purchase can't be recorded while an item is still undecided.

Alongside this, an invoice now **fills in blanks** on parts you already stock: a missing brand, OEM
number, HSN code, or a part number that was only ever an auto-generated "SP-014" placeholder. Details
you entered yourself are never overwritten — where the invoice disagrees with what's on file, the
review screen tells you and keeps yours. New parts created from an invoice now also start with the
real part number from the document instead of an SP-### placeholder.

## 2026-08-22 — AI answers no longer wait on whichever service is being slow

The backup service already covered Google *failing*. This covers Google being *slow*, which was
costing real time: a request could sit for the full 14 seconds waiting on Google before the backup
was even asked.

Now, if the leading service hasn't answered within a few seconds, the app starts the second one
alongside it and takes whichever answers first. The slow one is cancelled. A sluggish service now
costs a few seconds instead of the full wait.

The quick, fiddly things — categorising an expense, suggesting part details, drafting a payment
reminder — now ask the fastest service first and come back in well under a second. Business Insights,
the Forecast, Reports summaries, invoice scanning and catalog descriptions still lead with the
better-quality model, because there the answer matters more than the second saved. Both services stay
available to every feature either way; this only changes who gets asked first.

Also fixed the real reason the AI kept failing: the app was pointed at `gemini-flash-latest`, which
automatically follows Google's newest model — and the newest model has the *smallest* free daily
allowance, as low as 20 requests. Pinning a slightly older model gives far more free usage per day.

## 2026-08-20 — AI features now have a backup, instead of failing when Google is busy

Google's free AI service refuses requests when it's under heavy load — the "high demand" error you've
been hitting. Until now that meant the feature you clicked simply didn't work until Google recovered.

Every AI feature now has a second service standing behind it. If Google is busy, slow, or down, the
app quietly retries the same request on Groq (a free service, no card needed) and you get your answer
without noticing anything happened. If Google is only briefly stumbling, it retries there first before
switching. Only when *both* fail do you see a message — and it's now one plain sentence rather than a
wall of technical text.

Covered: Business Insights, Stock Reorder Forecast, Reports summaries, expense categorising,
payment-reminder drafts, part-detail suggestions, Website Catalog descriptions, and scanning a
**photo** of a supplier invoice to record a purchase.

Three things still depend on Google specifically and can't switch: scanning a **PDF** invoice
(photos of invoices are covered), Reference Search in the Website Catalog, and AI product photo
generation. Those fail safely with a message, exactly as before — for a PDF, photographing the invoice
instead will now go through the backup.

Nothing changes in how you use the app, and no setting to turn on — the backup key goes in the same
configuration file as the Google one.

## 2026-08-19 — Removed Daily Briefing

Taken out completely, at the owner's request. That's the popup that used to open by itself once a
day with a short AI-written summary of the business, plus the sunrise button in the top bar that
let you bring it back up whenever you wanted. Both are gone — nothing opens on its own any more,
and there's no longer a button for it. The AI request that generated that summary is gone with it,
so the app isn't spending one every morning.

**Nothing else that uses AI was touched** — Business Insights, the Stock Reorder Forecast,
scanning a supplier document to record a purchase, Reports summaries, expense categorising,
payment-reminder drafts and the Website Catalog's AI tools all still work exactly as before. Each
generates its own thing from its own data; none of them had anything to do with the Daily Briefing.

## 2026-08-16 — Fixed: no way to open the menu on a phone

Now that this is reachable from a real web address, it needed to actually work on a phone —
and it didn't. Below tablet width, the side menu (Inventory, Sales, Purchases, everything) slid
completely off-screen with no button anywhere to bring it back. On a phone, after signing in,
you'd see the top bar and the page content and nothing to tap to get anywhere else.

Added a real menu button (top-left, phone-sized screens only) that slides the full menu in over
the page, with a dark backdrop you can tap to dismiss — standard mobile-menu behavior. The menu
also now closes itself automatically once you tap something in it, so it doesn't sit open over
whatever page you just navigated to.

## 2026-08-16 — Fixed: Dashboard and Inventory silently showing ₹0 and "0 parts"

Right after the real-login work landed, the Executive Dashboard and Inventory could get stuck
showing ₹0 for every KPI and "0 parts" — even with real data sitting in the database for the
active company. No error, no loading spinner stuck on screen — it just quietly looked like an
empty company. The same underlying gap silently affects every other page that reads company data
(Sales, Customers, Purchases, etc.) too — Dashboard and Inventory are just the two that now show
an honest error instead of fake zeros, matching the fix already proven out elsewhere in the app.

**What was actually happening:** the one request every page makes on load to find out which
company is "active" (`/api/companies/active`) had no error handling — if that single request
ever failed for any reason (a slow/cold database connection, a brief hiccup), the app had no way
to notice or recover. It just silently stayed convinced no company was active, which meant every
other panel that depends on "the active company" (Inventory, Sales, Customers, everywhere) kept
showing zero, forever, with nothing on screen to say why.

This exact failure mode was already found and fixed once before, on a different branch of this
app, the day before real login was added here — that fix (proper error handling, plus an honest
"Can't reach the database right now" message instead of fake zeros) had just never made it onto
this branch. Reapplied it here rather than re-solving it from scratch.

## 2026-08-15 — Real login added — the app now has an actual lock on the door

Until today, "Sign In" was fake: the login screen accepted anything you typed (it even had a fake password pre-filled) and every single page and API endpoint — Inventory, Sales, Customers, Reports, Settings, all of it — was reachable by anyone who had the URL, no password required. That was fine while the only way to reach this app at all was installing the desktop program on a specific PC. It stops being fine the moment this app is reachable at a real web address instead, which is the actual goal (see the next entry, once it lands) — so real login had to come first.

**What changed:**
- Signing in is now real, backed by Supabase Auth. A login also has to match an actual staff record (Settings → User Roles & Access) that's been marked active — so even someone who somehow got a valid Supabase login some other way still can't get into this ERP without being explicitly added as staff.
- Every page and every API route now checks this before doing anything, enforced in one place (`proxy.ts`) rather than hoping each page remembers to check — confirmed by testing directly: a signed-out visitor hitting `/inventory` or the underlying data API gets bounced/blocked, not shown real data.
- **Settings is now Owner-only** — it's the one screen that can delete an entire company or hand out other people's access, so only the Owner role can reach it. Every other role (Manager, Salesperson, Accountant, Warehouse) currently has the same access to the rest of the app as before; more fine-grained per-role limits (e.g. should a Salesperson see Reports) are intentionally left for later, once real staff are actually using their own accounts day to day.
- **Inviting a teammate is now real**: Settings → Invite User sends an actual email with a sign-in link, instead of just adding a name to a list with no way to actually log in. They click it, set their own password, and they're in.
- The desktop app's one-time setup screen has a new field (Supabase's anon/publishable key) — needed for the login screen to work; existing installs will be prompted for it once on next launch via "Reconfigure Supabase / AI keys" if it's missing.

**Before this is usable day to day:** the very first (Owner) account needed a real password set, since the Supabase login that already existed for that email predated real password auth. Turned out to need a proper fix rather than a one-off: added a real "Forgot password?" link on the sign-in screen (`/forgot-password`) — enter your email, get a real reset link, set a new password yourself. The same "set a new password" screen now handles both finishing an invite and resetting a forgotten one.

**Not done yet, on purpose:** actually hosting this app at a public web address. That's the point of doing the login work first — it was the blocker. Deployment is the next step.

## 2026-08-10 — Fixed: Daily Briefing crashed every time it actually loaded
The Daily Briefing popup (the one that's meant to auto-open once a day, or open from the bell icon) was reading its receivables/payables figures under the wrong field names — so it crashed with a technical error screen every single time it successfully generated a briefing. It only ever appeared to "work" when Gemini wasn't set up, because that case never reached the broken code. Fixed and confirmed working end-to-end with a real briefing.

## 2026-08-10 — Swept the rest of the app for the same "saved but the screen didn't refresh" bug
After finding it twice in Inventory, checked everywhere else that could have the same problem: Sales, Purchases, Customers, Suppliers, and Expenses. Found one more real (if not yet visibly noticeable) case — recording, editing, or deleting a Sales invoice was never refreshing Inventory's stock numbers in the background, even though the stock change itself was saving correctly. Fixed. Purchases, Customers, Suppliers, and Expenses were all already correct.

## 2026-08-10 — Adding a new part now requires a real starting stock count
"Initial Stock" can no longer be left blank or set to 0 when adding a new part — you have to enter how many you actually have on hand. Editing an existing part's stock down to 0 (e.g. it's sold out) is unaffected and still works normally; this only applies to creating a brand-new part.

## 2026-08-10 — Recording a multi-line purchase is about twice as fast, and fixed a real duplicate-part-number bug along the way
Measured it properly: recording a 14-item purchase used to take about 11.5 seconds, because adding each new part to Inventory was reloading the *entire* parts list before moving to the next one — 14 full reloads for one purchase. It's now closer to 5.5 seconds: each part is still added one at a time, but the list only reloads once, at the end. There's a further, bigger speedup possible (getting this down to roughly 1-2 seconds by combining all the part-matching into the same single database step that already saves everything else) — flagged for a future pass since it touches the same core save logic more deeply.

Found and fixed a real bug while measuring this: because the app was checking "does this part already exist" against a list that never updated mid-purchase, two or more genuinely different new parts recorded in the *same* purchase could end up sharing one auto-generated part number (e.g. two unrelated parts both filed under "SP-235"). Fixed alongside the speed fix, since it was the same root cause.

## 2026-08-10 — Scanned invoices now capture the supplier's GST number, and the same invoice file can never be recorded twice
Two additions to the "Record Purchase from File" AI scan:
- It now reads the supplier's GSTIN off the invoice too, alongside the existing supplier name/date/items, and saves it automatically when creating a new supplier record. Backfilled GANPATI AUTO TRADERS' real GSTIN from the invoice used to test this earlier.
- **The exact same invoice file can no longer be scanned or recorded a second time.** This is enforced by the database itself, not just a warning in the app — every purchase records a fingerprint of its source file, and a second attempt with the same fingerprint is rejected outright, with a clear message naming the purchase it was already recorded as. Checked before the file is even sent to the AI (so a repeat attempt doesn't waste a scan), and enforced again as a hard guarantee at the moment of saving. This directly closes the door on the exact failure mode that caused this session's earlier duplicate-data cleanup — re-submitting the same invoice can no longer create a second copy of anything, no matter how many times it's tried.

## 2026-08-10 — Fixed: Inventory parts were getting added multiple times, and cleaned up ~580 duplicate records already sitting in the database
Found the cause after being asked why parts kept showing up two or three times: the "Add New Part" Save button had no confirmation it had actually saved (the same invisible-wait problem fixed in Purchases/Sales the same day) — so re-typing the same part because the first attempt looked like nothing happened just created another one, silently, every time. Fixed: the Save button now shows "Saving…" and disables itself, and — new — if you're about to add a part with the exact same name as one that already exists, you'll see a warning with the existing part's stock before you submit, so it's a choice, not an accident.

Also cleaned up the actual damage this had already caused: 542 duplicate parts in Inventory (mostly in Jai Durga Enterprises, from repeated attempts to add the same 14-part GANPATI AUTO TRADERS invoice by hand) plus a smaller, separate mess in company "bkgkj" — 3 duplicate copies of that same purchase and 1 duplicate copy of another, both from before today, which needed properly reversing the stock and supplier-balance effects of each extra copy, not just deleting rows. None of the duplicates had been sold, so no sales history was touched. Verified with rollback-tested checks before anything was changed for real.

## 2026-08-10 — Removed Credit Limit
Taken out everywhere it showed up — Customers (the field on each customer card and the Add Customer form) and Sales (the over-limit warning when creating an invoice). Not used, so it's gone rather than left sitting unused.

## 2026-08-10 — Fixed: Sales and Purchases could silently fail to save at all, depending which company you're in
Found and fixed a serious bug while testing yesterday's Purchases fix against a real supplier invoice: recording a Sales invoice or a Purchase could fail every single time for a company that has fewer existing records than another company on the same account — which, for Jai Durga Enterprises specifically, meant **every** attempt to record its first-ever Purchase or Sales invoice was guaranteed to fail.

**What was happening:** invoice/PO numbers (like "PO-1001") are shared across all your companies on this account, not separate per company — but the app was guessing the next number by looking only at the current company's own records. A company with zero purchases so far would always guess "PO-1001" as its first number, even when another company already had one. The save was then rejected as a duplicate — and because of yesterday's still-in-progress loading-indicator gap, that rejection was invisible, so it just looked like nothing happened.

**Fixed at the source:** PO, GRN, and invoice numbers are now generated by the database itself, at the moment of saving, from the real record across every company — not guessed in the browser beforehand. This closes the bug for good, for every company, not just the one that surfaced it.

**Also fixed while tracking this down:** importing a purchase from a scanned photo could garble a line item's name if the AI's description happened to contain a dash — e.g. "LOADER CUTTER KIT - JCB" was being split and stored backwards as a part named "JCB" with part number "LOADER CUTTER KIT". That auto-split was only ever meant for the manual entry form (where a dash means an already-formatted "part number - name" pair copied from the dropdown); it's now skipped for AI-scanned text, which is just a plain description.

**Same root cause, found and fixed in Expenses too:** logging an expense had the identical bug — the next "EXP-" number was guessed from the current company's own records only. It hadn't caused a real failure yet (no company had logged an expense before now), but the first two companies to each log their own first expense would have collided the same way Purchases/Sales did. Fixed the same way: the database now generates the expense number itself.

## 2026-08-09 — Independent audit review: crash-proof Sales/Purchases, security patches, honest error states
An outside code audit reviewed the whole app. Most of what it flagged has been fixed now; a few larger items are logged below as deliberately not done yet, for a separate decision.

**Sales and Purchases can no longer half-save.** Recording an invoice or a purchase used to be 4–9 separate steps sent one after another from the browser (create the invoice/PO, add each line item, update stock, adjust the customer/supplier balance...). If your connection dropped or the app crashed partway through, you could end up with a purchase on record but no stock added, or stock consumed but the customer never billed for it, with no clean way to tell. Both now happen as one all-or-nothing operation on the database side — either the whole thing saves correctly, or nothing does and you get a clear error to fix and retry. Editing or deleting a Sales invoice got the same fix.

**Two real security holes in outside code libraries, closed.** Next.js (the framework this app is built on) bundled a component with two known high-severity issues — updated to the fixed version. The Excel/CSV file-import library had two more (a malicious spreadsheet could exploit them) with no fix available through the normal update channel — switched to the library's own official patched build instead. A production dependency scan went from 5 high-severity issues to 1 (an unrelated, low-exposure build-tool issue, left alone since it wasn't part of this fix).

**Dashboard, Inventory, and the public Catalog now tell you when something's actually broken**, instead of quietly pretending everything's fine. Previously, if the app couldn't reach the database, the Dashboard silently showed ₹0 everywhere and Inventory silently showed "No parts found" — indistinguishable from an empty, working store. Both now show a clear "can't reach the database" message instead. The public Catalog page had the same gap the other way round: a database hiccup showed visitors a raw technical error page instead of your site's own "check back soon" message.

**A few honesty fixes on things that looked more finished than they are:**
- The top-bar "Search everything" box only ever searched page names (Inventory, Sales, etc.), never real parts/customers/invoices despite what its placeholder text implied — reworded so it's not overpromising.
- The "Low Stock" badge next to Inventory in the sidebar was permanently on, not a live count — turns out it wasn't even wired up to render, so it's removed rather than left as dead code.
- Purchases' "Supplier Invoices" tab always claimed "no unmatched supplier invoices," which reads like a working, empty inbox — there's no such matching feature built, so it now says so plainly instead.

**Cleanup:** fixed all 11 lint errors the audit flagged (`npm run lint` now reports zero errors) — mostly Electron/build-script files being checked against web-app coding rules by mistake, plus a couple of real React mistakes in the Website Catalog editor.

**Deliberately not done in this pass** (flagged by the audit, each worth its own decision before tackling):
- Real staff login/passwords — today's login screen still accepts anything and routes straight in. The ERP itself still isn't exposed to the internet (only the read-only Website Catalog is), which is why this was lower urgency than the items above — still on the list.
- The generic data API and the database's own access rules (RLS) still don't check who's asking, or which company a request should be scoped to — same reasoning as above, tied to the login decision.
- No performance work yet — the Dashboard still makes far more database requests than it needs to as data grows.

## 2026-08-07 — Update 3.0: Website Catalog goes live — search, filter, WhatsApp, quote requests, and three real bugs fixed
Built out the public Website Catalog based on a PRD review, closing the gaps the original build flagged as "not included yet," and put the result live on the real jd-enterprise.com — not just this app's own preview pages.

**New for customers, on the public catalog:**
- **Search and filter** — search by part name, part number, OEM number, brand, category, or compatibility; filter by brand, category, or stock status. Brand/category badges on each card are clickable shortcuts to that filter. A "no results" search now offers a direct WhatsApp button instead of a dead end.
- **WhatsApp added to Request a Quote** — alongside the existing email/call buttons, both the catalog listing ("Quick Quote") and the product page now open a prefilled WhatsApp message, matching how customers already reach out today. The quote-request phone number in Settings was filled in with the number from the business's own catalog planning document, since it was blank — worth a quick double-check that it's current.
- **On-site quote request form** — the product page now also has a proper form (name, phone, quantity, machine model, message) that logs the request and shows an on-screen confirmation, instead of only opening the customer's own email app.
- **Breadcrumbs and a "Last confirmed" date** on the product page, plus better link previews when a catalog link gets shared (e.g. pasted into WhatsApp).

**New for staff, under Website Catalog:**
- **Leads inbox** — every quote-request submission shows up with a status you can update (New/Contacted/Closed); the notification bell now flags new ones.
- **"Recheck Against Inventory"** — flags any published listing whose price or stock status has drifted from Inventory since it was last published, with a one-click fix. Turns keeping the catalog honest into a fast, occasional staff task instead of something that has to be remembered per item.
- **"Public Website Catalog" toggle** in Settings → Companies — only one company's published listings can be the public storefront at a time, independent of which company is "active" for day-to-day work.
- The "View Public Site" button was renamed to **"Preview Catalog Pages"** with a tooltip, since it opens this app's own local catalog pages, not jd-enterprise.com — the two were easy to confuse.
- Basic usage tracking added (search terms including zero-result ones, and product views) as a foundation for reporting later — no dashboard for it yet.

**Three real bugs found and fixed, all caught by testing against the live database rather than trusting a clean build:**
1. **Cross-business data leak, at both places this data is read from.** The public catalog queries weren't filtering by company at all — on the Supabase project this app shares across more than one business, any business's published listings could have shown up mixed together on this JD-Enterprises-branded site. Fixed in this app's own code (scoped to whichever company the new Settings toggle flags), and separately in the database access rule the *real* jd-enterprise.com site reads through directly (it talks to Supabase itself, not through this app) — that rule had the identical gap. The first fix attempt at the database layer actually made the catalog show up empty for everyone, caught immediately by testing as a real anonymous visitor would see it (not as an admin, which bypasses these checks entirely) — fixed properly on the second pass. No leak had happened yet in practice, but it's closed now either way.
2. **Silent data loss on delete.** Deleting an Inventory item that had ever been added to the catalog — even in draft — was silently and permanently deleting that catalog listing outright (photos, AI-written descriptions, everything), because of a database rule set up when Website Catalog was first built. Deleting an Inventory item now correctly takes its catalog listing off the public site (unpublished, not destroyed) instead.
3. A transient dashboard/briefing display bug was investigated and turned out **not** to be a real bug — noted here only because it was reported as one mid-session before a closer look; no code change was needed.

**Now actually live:** the real jd-enterprise.com site's four "GET QUOTATION" buttons now open a real, live product list per brand (JCB has 2 real published parts today; CAT/Terex Vectra/HYVA JACK show an honest "nothing published yet" state until real parts are added for them) — deployed via that site's own repository and Cloudflare Workers process, separate from this app. This app itself — Inventory, Sales, Customers, Settings, and everything else — is still not deployed anywhere public, deliberately: none of its pages have a login of any kind yet, so that stays a separate, future decision.

## 2026-08-04 — Fixed: recording a purchase could crash the page instead of showing an error
- Found and fixed a real bug: if saving a purchase (or a file-imported purchase, or marking one "Received") ran into a database error partway through — most likely two computers recording purchases at almost the same moment — the whole page used to crash with a raw technical error screen instead of telling you what went wrong. It now shows a plain error message in place, and the "Save Purchase" button shows "Saving…" so it's clear when it's working.
- This was a gap in how every save/update/delete talks to the database across the whole app, not just Purchases — fixed at the source, so the same crash-instead-of-error-message problem can't happen elsewhere either.
- If you've seen duplicate-looking purchase orders (e.g. the same supplier/items/date appearing more than once), that's very likely a symptom of this bug — a save that silently failed partway got retried. Worth a look in Purchases; I didn't touch or delete anything there myself.

## 2026-08-04 — Website Catalog: delete option added
- You can now delete a catalog listing directly from the Website Catalog list, not just from inside it — with a confirmation first. Delete is available for anything not currently live (draft, unpublished, or archived); a listing that's actively published has to be unpublished first, so nothing disappears off the real website by accident.

## 2026-08-04 — Website Catalog: quick link to a published listing
- The Website Catalog list now has a "View Live" and a copy-link button next to any published item, so you can jump straight to (or grab the link to) the actual website page without opening the item first. Only shows up once something's actually published.

## 2026-08-04 — Website Catalog: description drafts read a lot less like a form letter
- The "Generate Draft" description writer was too conservative — it was just restating the brand/part number/category as sentences ("This is a JCB filter kit under the Filters category...") instead of writing anything useful. It now actually reads the product name and any notes you've typed and pulls out the real specifics already there (a service interval, a standard like BS5, what's bundled in a kit, etc.) into natural-sounding copy and genuinely useful key features — still never inventing anything not already stated in your data, just no longer wasting what you gave it.

## 2026-08-04 — Website Catalog: AI product photos now use your reference photo as a guide
- "Generate with AI" no longer guesses blind from a text description. When you've picked a reference photo in Reference Search, it's now handed to the AI as a visual guide for the real part's shape and proportions, so the result looks much closer to the actual item instead of a generic stand-in. The reference photo itself is never saved or published — only the newly generated image is. Without a reference picked, it still falls back to generating from the text description alone, same as before.
- The Generate with AI button now tells you upfront whether it has a reference photo to work from.
- Worth remembering: even with a reference photo, AI generation is still an approximation, not a copy — uploading a real photo of the actual part remains the only way to guarantee an exact image.

## 2026-08-03 — Website Catalog: publishing now double-checks Inventory first, and a real AI bug got fixed
- Before you can publish a catalog listing, it now compares the price and stock status against what Inventory currently shows. If they've drifted apart (you changed the price, or it sold out, since the draft was made) you'll see exactly what changed and a one-click "Sync from Inventory" button — or you can publish anyway if the difference is intentional. If the part was removed from Inventory entirely, publishing is blocked outright.
- Fixed a real bug: "Generate with AI" for the product photo was failing every time with a confusing error, because the AI image model it was using had been retired by Google. Switched to the current model — this should now work normally (subject to the same daily AI usage limit as every other AI feature here).

## 2026-08-03 — Website Catalog: turn Inventory parts into a public parts website
- New "Website Catalog" section in the sidebar. Pick any part from Inventory to start a draft, fill in what's missing, and step through: search the web for reference photos (guidance only — nothing is ever auto-downloaded or published), generate a locked-down AI image prompt from the approved fields, either generate a photo with AI or upload a real one, draft an editable product description, preview exactly what the public page will show, then publish.
- New public pages at `/catalog` (browse) and `/catalog/[id]` (detail) — visible to anyone, no login needed. They only ever show parts you've explicitly published, and only the customer-safe fields (name, part number, brand, compatibility, category, availability, price or "Request a Quote") — cost price, stock counts, supplier info, and anything still in draft/review are never shown, enforced at the database level, not just hidden in the page.
- Unpublish takes a listing down without deleting your work; Archive retires it for good. Both are separate from Draft so you can always tell what's actually live.
- Added an optional "Quote Request Email / Phone" to Settings → Company — when set, published listings get a working Request a Quote / Call button; left blank, the button is simply hidden rather than showing something broken.
- Every AI step here is a suggestion you review and edit before it's ever shown publicly — nothing publishes automatically, matching how AI already works everywhere else in this app.
- Not included yet (planned for later): search/filtering on the public catalog page, a proper quote-request inbox inside the ERP (for now it's a plain email/call button), and analytics/audit reporting on the catalog itself.
- Worth knowing: this app doesn't have real per-user login anywhere yet (Settings → "Sign In" is a placeholder), so Website Catalog admin actions are protected the same way every other ERP screen is today — not more, not less. The one hard boundary is on the server: only published listings are ever readable by the public site, and only from inside this app.

## 2026-08-01 — Fixed: editing just the cost price didn't always update the displayed margin
- If you edited a part in Inventory to correct its cost price without also changing the stock count, the number shown (and the margin calculated from it) could keep showing the old cost — because that edit only updates the "sticker" field, not the underlying priced batch the display actually reads from. Now correcting the cost price on its own also corrects the batch that's currently in view, so what you type is what you see.

## 2026-08-01 — Reports page redesign
- Every report tab now leads with colorful stat cards (matching the style already used on the Dashboard and Analytics pages) instead of plain text rows, so the headline numbers are readable at a glance.
- Profit & Loss and Stock Valuation each got a visual bar breakdown (revenue vs. costs, and stock value by category) alongside the detailed numbers — nothing removed, just easier to scan before reading the full table.
- Aging's four day-range buckets are now color-coded by urgency (green → amber → orange → red) for both receivables and payables.

## 2026-08-01 — Walk-in sales don't need a customer anymore
- Creating a Sales invoice no longer requires picking a customer — leaving it blank now records the sale as "Walk-in Customer" instead of blocking you. Stock still updates normally; since there's no real customer account behind a walk-in sale, no balance or credit limit is touched. Editing a walk-in invoice later correctly shows it as unselected again rather than getting stuck on the stored label.

## 2026-08-01 — AI added to four more places
- **Customers & Suppliers**: a new sparkle button next to an outstanding balance drafts a ready-to-send payment reminder (or, for suppliers, a payment follow-up) — pulls in the real oldest overdue invoice/PO, editable before you copy and send it.
- **Reports**: every report tab now shows a short AI-written summary explaining what the numbers mean, on top of the tables already there. It only describes what's actually in the data — if a report is empty, it says so plainly instead of inventing a story.
- **Expenses**: typing a description and moving on now suggests a category automatically (still fully overridable from the dropdown).
- **Inventory**: typing a new part's name suggests a category and, only when actually stated in the name (e.g. "Bosch Oil Filter"), a brand — it deliberately leaves brand blank rather than guess one, and never touches vehicle-compatibility data.
- Along the way, fixed a real bug this work surfaced: the Reports AI summary could show stale wrong text (e.g. "no financial activity" next to real revenue numbers) because a fast initial empty-data request could resolve after a slower real-data one. Also cleaned up the raw technical error Gemini returns when its free daily quota is hit, so it now reads as a plain sentence instead of a JSON dump.

## 2026-08-01 — Same fix for Sales invoice lines
- Sales invoice lines had the same visual problem as Purchases: adding a line always pre-filled with your first Inventory item, making it look like every row was stuck on the same part. Every new line now starts unselected ("Select a part…") instead. Unlike Purchases, Sales can't accidentally do nothing here — the part field is a strict dropdown of what's actually in Inventory, not free text, so this was purely a display fix.

## 2026-08-01 — Recording a purchase of a brand-new part
- Fixed: typing a part into Purchases that wasn't already in Inventory silently did nothing — no new item, no stock added — because only new *suppliers* got auto-created, not new *products*. Buying something for the first time now correctly adds it to Inventory (at the price you just paid) and stocks it, the same way a new supplier already got created automatically.
- Fixed: the Product field on a new purchase row used to pre-fill with your first existing part, making it look like you couldn't type anything else. Every row now starts blank with a hint showing whether it matched an existing part or will create a new one.

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
