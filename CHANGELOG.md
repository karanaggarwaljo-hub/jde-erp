# Changelog

All notable changes to JDE ERP, in plain language, newest first.

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
