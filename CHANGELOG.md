# Changelog

All notable changes to JDE ERP, in plain language, newest first.

## 2026-09-02 — Tidied: settling an invoice moved into the invoice window

Reported: the customer settlement button wasn't looking good — could it be merged into something.

It had been given its own icon in the Sales table, which pushed that Actions column to six small
buttons side by side. Too many to read at a glance, and the wrong place for the decision anyway.

Settling now lives inside the invoice's own View window (the eye icon), as a **Settle for less**
button at the bottom left — right under the Total, Paid and Balance figures you need in order to
make the call. The Sales row is back to five icons.

Nothing about how it works changed: the same window opens, the same amount and reason, the same
rules. The tick box inside Receive Payment is untouched, so a customer handing over less than they
owe can still be settled in one step while you record what they did pay.

## 2026-09-02 — New: Everyday Activity on the Dashboard

Asked for: something like the activity grid in that screenshot, showing everyday activity.

Added to the Dashboard, above Recent Activity: one small square per day, shaded by how much you
did, plus the figures that go with it — days with activity, your current run of working days, your
longest run ever, your busiest single day, and the total records on file. Hover any square to see
that day.

Every square counts real records — invoices, purchases, expenses and quotations — on the date
written on each one. Parked drafts are left out; a sale you haven't confirmed isn't a day's
trading.

**Two things in that screenshot are deliberately missing.**

*Peak hour* is not there, and won't be, because this system doesn't know it. A sale carries a date,
never a clock time. The nearest thing in the database is when a record was typed in — and that is
badly misleading: 675 of your opening-stock entries all landed in one late-night hour because that
is when the stock was bulk-loaded, not because 11 PM is when you trade. A "peak hour" drawn from
that would look convincing and be false, so the card says plainly why it isn't shown.

*Six months of squares* is also gone. Your records start on 30 July, so a fixed six-month grid
would show four blank months that read as quiet days when the truth is the books don't go back
that far. The grid now reaches back to your oldest record and no further — eight weeks today,
growing on its own to a six-month maximum as you keep using it.

Right now it shows 10 days with activity, a longest run of 4 days, and 1 September as your busiest
day with 7 records.

Eighteen automated tests cover the counting, the streaks, and the awkward cases — a run that
reaches yesterday is shown as still alive rather than broken, since the day isn't over.

## 2026-09-02 — Closed a side door into the database

Nothing was broken and nothing was stolen. This is a lock that should have been on a door that
was already bolted shut another way.

The app talks to the database through a set of named operations — "save this invoice", "record
this expense", "adjust this stock". Fifteen of those, including the main *save a sales invoice*
one, were left open in a way that let anyone on the internet **call** them without signing in,
using the public key that the shop website has to publish in its own pages.

**They could call them, but they could not achieve anything.** Each one ran with the caller's own
permissions, and the tables themselves refused every read and write from an unknown visitor. That
was checked directly rather than assumed: an attempt to insert an invoice as an anonymous visitor
was rejected by the database, and an anonymous visitor could see zero invoices. So no invoice
could have been forged, no stock moved, no balance changed.

What was wrong was that a *single* protection was doing all the work. If any one table ever had
that protection switched off or loosened by mistake, there was nothing behind it. Now there are
two independent locks instead of one, which is how the newer operations in the app were already
set up — this brings the older ones in line with them.

The sweep also turned up leftovers nobody knew were there: three old unused versions of *save a
purchase* and two of *receive purchase stock*, still callable, plus a helper that exists in no
project file at all. All are now closed off too.

**The same was then done for the data tables themselves.** Eighteen of them — invoices, customers,
products, suppliers, stock, expenses, purchase orders and the rest — were also still listed as
readable and writable by an anonymous visitor on paper, again with the table's own protection
being the only thing actually refusing them. Those listings are now removed too. The difference is
visible from outside: asking the database for your invoices without signing in used to be turned
away by the protection layer, and is now turned away one step earlier, for not being allowed to
ask at all.

The shop website is unaffected — the one operation and the one table it depends on were
deliberately left alone, and the catalogue was confirmed afterwards still returning all five
published parts. Saving invoices in the ERP is unaffected: the app signs in with a privileged key
that keeps full access, confirmed by running the invoice-saving operation through that key and
undoing it immediately.

Two things were found and deliberately **not** changed, because they need a decision first: a set
of twenty older `erp_` tables that appear to be built for a different kind of sign-in, and six
unused tables left over from the template this project started from. Neither is referenced
anywhere in the app.

Recorded in `scripts/lock-down-jde-function-grants.sql` and
`scripts/revoke-leftover-anon-table-grants.sql`.

## 2026-09-02 — Fixed: the daily backup had not run once since the site went online

Your live data was never in danger — Supabase holds the real thing, and nothing here touches it.
What had stopped working was the spare copy.

**What was wrong.** The app tried to save each day's snapshot into a folder on the machine it was
running on. That was right when the ERP ran from a computer in the office, but the live site does
not work that way — it has no folder of its own to write to, and keeps nothing between one visit
and the next. So every attempt failed the moment it started, about once an hour, filling the server
log with the same error each time. There had been no snapshot at all since the app moved to
erp.jd-enterprise.com.

**Where backups go now.** Into a private storage area inside your own Supabase account, next to
where the website catalogue photos already live. Private, not public: checked directly, the file
cannot be opened by anyone who hasn't gone through the ERP signed in as owner.

**When they happen now.** Once a night, run by the same real scheduler that already handles the
nightly platform sync, instead of by the app noticing the time while somebody happens to have it
open — which is the part that could never have worked on a live site. Snapshots older than 7 days
are still cleared out automatically.

**You can now download a backup.** When these files sat on a hard drive you could always go and
find one; now that they're in the cloud, each row in Settings → Data Backups has a Download button
that saves it to your computer. Worth doing occasionally — a copy on your own machine is the only
one that would survive losing the Supabase account itself.

**Also fixed while in there:**

- **The snapshot was close to silently losing data.** It asked for every row of every table in one
  go, and Supabase quietly stops answering at 1,000 rows. Your parts list is already past 900.
  A few dozen more parts and every backup would have been cut short while still looking complete.
  It now reads everything in batches, however large a table gets. Checked row for row against the
  live database afterwards: every table matches exactly.
- **Any member of staff could have downloaded all of your data.** The Settings screen was owner-only,
  but the web address behind it wasn't — anyone with a working login could have pulled a full copy
  of every company's records straight from it. Now owner-only, matching the screen.
- **A backup now takes 4 seconds instead of 14**, because it reads all the tables at the same time
  rather than one after another. Beyond being quicker, it means the snapshot is taken across a
  narrower moment, so a sale recorded midway through is less likely to be caught half in, half out.
- **The repeating error in the server log is gone**, because the thing producing it no longer exists.
- **The desktop version's local backup folder was removed**, since you confirmed everyone works from
  the website now. One place backups live, one way they're made.

**Nothing to set up.** The nightly backup is protected by the same `CRON_SECRET` already in use for
the platform sync, so if that one is running, this one will too.

## 2026-09-01 — When a customer settles by paying less

Reported: sometimes a customer settles their payment by giving a lesser amount.

There was nowhere for that to go. If a customer owed ₹41,356.75 and handed over ₹40,000 with
"that's settled", the ₹1,356.75 stayed on the books forever — the invoice never closed, the
customer kept appearing in your collection queue, and your receivables total counted money nobody
was ever going to pay.

**Two places now handle it.**

When you record the payment, each open invoice has a *Settle for less* tick box showing exactly
what would be left over — tick it and that remainder is forgiven as part of the same action.

And any invoice with money still owing has a new button in Sales (the hand-with-coins icon) for
settling one after the fact, with a box for why — "rounded off in cash", "agreed discount for late
delivery". Useful for the ones already sitting open.

**What it deliberately does not do is pretend the money arrived.** The easy way to build this
would have been to add the shortfall to the invoice's "paid" figure. Everything would close
neatly — and every takings figure, report and AI summary in the app would then be quietly
overstated by money you never received. So the invoice keeps the total it was issued for, "paid"
keeps meaning cash that actually came in, and what you let go is recorded separately and labelled
"written off" wherever it appears. The customer stops owing it; your takings stay honest.

Every screen that showed what a customer owes now understands settled invoices — the Sales list,
the invoice page, the customer collection queue, the Dashboard's unpaid-bills warning, the
receivables report and its ageing table, the exported spreadsheet, and the AI daily briefing.

A settled invoice can no longer be edited or deleted, and says so — its amounts are fixed once you
have agreed the account is closed.

Checked against the live database with real invoices and undone immediately: writing off part of a
balance, then the rest; trying to write off a rupee more than is owed, a zero, a negative, another
company's invoice, and a second settlement on an already-closed invoice — the first two accepted
with the customer's balance moving by exactly the right amount and the paid figure untouched at
₹40,000 throughout, the rest refused with a plain message. Twelve new automated tests cover the
arithmetic.

## 2026-09-01 — Supplier payments, and showing what a scan actually read

Reported: the HSN code isn't being extracted from the invoice, and there's no way to say whether
the supplier has been paid.

**The HSN code was being read — you just couldn't see it.** Checked against your own data: the
part from that KRISHNA HYDRAULICS invoice was created with part number 331/34392, HSN 84129090 and
brand JCB, all read off the photo. None of it appeared on the review screen, so there was no way
to tell it had worked, and no way to type it in on the occasions it doesn't.

The review screen now shows all four — part no, HSN, OEM no and brand — under each item, and each
one can be edited before you save. Correcting a part number there can also turn a "new part" into
a match against something you already stock.

**Payment to the supplier is now asked when you record a purchase from a file.** It never was: the
dialog silently recorded every scanned invoice as unpaid credit, which added the whole amount to
that supplier's balance even if you had paid on the spot. It now has the same Paid in Full /
Partially Paid / Unpaid choice the manual purchase form has, with the balance shown before you
commit.

**And any purchase can now be paid afterwards.** Each order with money still owing has a Record
Payment button. Until now the only payment control was on the Suppliers screen and it worked on
the supplier as a whole — it spread your money across their oldest unpaid orders automatically,
with no way to settle one particular invoice.

The order's paid amount and what you owe that supplier now move together, in one step that either
fully happens or doesn't happen at all. The old Suppliers-screen route updated each order and then
the balance in separate calls, so an interruption partway could leave orders marked paid against a
balance that was never reduced. It also refuses, with a plain message, to accept more than the
order still owes, an amount of zero, or a second payment on something already settled.

Checked against the live database with real orders and undone immediately: a part payment, a full
payment, an over-payment, a zero, a negative, another company's order, and a double payment — the
first two accepted with both numbers correct, the rest refused.

**One thing to correct yourself:** PO-1009 (KRISHNA HYDRAULICS, ₹4,440.70) was recorded before
this, so it is filed as unpaid. If you have paid it, use Record Payment on that row.

## 2026-09-01 — Fixed: returns were crediting customers too much

Reported: the return isn't fully wired.

Correct, and it was my omission. When per-item discounts and the GST inclusive/exclusive choice
were added to invoices, credit notes were not updated to match — so a return calculated the credit
the old way and **gave the customer back more than they ever paid**. Two separate ways:

- **A part sold at a discount was credited at full price.** Your invoices use this — an item at
  ₹7,170 discounted to ₹6,094.50 would have been credited the full ₹7,170.
- **On a GST-included invoice the tax was added a second time**, on top of an amount that already
  contained it.

Both now credit exactly what was charged:

                            invoice total   credited BEFORE   credited NOW
    GST extra (18%)              2,124.00         2,360.00       2,124.00
    GST included (18%)           1,800.00         2,360.00       1,800.00

Returning an entire invoice now leaves exactly zero owing, whichever way it was priced. Checked
against the live database with both kinds of invoice and undone immediately.

**Part-returns are right too.** Returning 2 of 5 credits two units at the discounted rate, not the
list rate.

**The confirmation screen was showing the same wrong figure**, so you would have approved a number
that was never going to be the credit. It now shows what each line was actually charged — and says
"discounted from ₹7,170" where a line carried a discount — and the note underneath explains that
the invoice's own discount and GST are applied on top, mentioning when GST comes out of the amount
rather than being added to it.

Nothing already recorded was altered. Existing credit notes keep the figures they were issued with;
this changes what happens from now on.

## 2026-09-01 — Fixed: a backup-AI hiccup showing you a raw error instead of just working

Reported: "Groq 400: Failed to validate JSON. Please adjust your prompt."

Two things were wrong, and the second is the one that actually reached you.

**The backup AI service occasionally garbles its answer.** When reading a photo, it was being asked
for JSON by *describing* the required shape in the instructions and hoping for the best, rather than
being told the shape formally — which the service does support, and which stops it producing a bad
answer in the first place. It now gets the shape properly. (Tested directly: it reads the same
photo correctly either way, but only the formal method makes a bad answer impossible rather than
unlikely.)

**And when it did garble one, everything stopped instead of falling back.** This is the real fault.
The app treats that kind of refusal as "we asked for something impossible" — which is a sensible
rule, because a genuinely malformed request fails the same way everywhere, so trying a second
service would just waste time. But a garbled *answer* is not a malformed request. It says nothing
about whether Google's AI could do the job — and it could, easily. So the app gave up and showed
you the backup service's raw complaint while a perfectly good alternative sat untried.

Now that specific refusal is treated as "this service failed at this task", which means the next one
is asked and you simply get your result. A genuinely malformed request still stops immediately, as
before — that rule was right, it was just being applied to the wrong thing.

Covered by five new automated tests, including one that fails a provider exactly the way this
happened and checks the answer still comes back from the next one.

**If you see a raw error naming an AI service again, tell me** — you should never see one. Every one
of these is either something that should have failed over quietly, or something worth explaining in
plain words. Being shown the machinery is a bug in itself.

## 2026-09-01 — Inventory now reads a photo of a parts list

Reported by dropping a WhatsApp photo onto Inventory and being told to go and use Purchases instead.

That was a poor answer. Purchases reads a *supplier invoice* and records a purchase — it is not
where you go to get a parts list into Inventory. So Inventory now reads photos and PDFs itself.

**Drop a photo of a parts list, a stock sheet, a supplier's price list or a page from a register,
and it reads it.** What comes back goes into exactly the same preview you already get from a
spreadsheet: the list of rows, what will happen to each one, tick boxes to choose, and the same
choice between updating the cost of parts you already have and adding new ones. Nothing is saved
until you press the button.

Tested on a deliberately awkward photo — camera noise, uneven lighting, an off-white page — of a
four-row stock list. It read every row correctly: item code, description, brand, quantity and rate.
Matched against your real inventory, three were recognised as parts you already stock (offered as
cost updates) and the fourth as genuinely new. It worked out on its own which column was the cost
and which identified the part.

This is a different job from the invoice scan and is read differently. A price list often has no
supplier, no date and no totals — it is a list of parts, and the useful columns are the ones
Inventory actually keeps: code, name, brand, category, HSN, quantity, cost, selling price, MRP. It
is told to leave anything blank that the page does not actually show, rather than carrying a value
across from the row above.

Practical notes:

- **Photos are shrunk in your browser before being sent**, the same as the invoice scan, because a
  phone photo is otherwise too large to reach the app at all.
- **A PDF over 4MB is refused with a reason**, since a PDF cannot be shrunk that way — save it
  smaller or photograph the page.
- **If nothing readable is found**, it says so and suggests getting the whole page in frame and in
  focus, rather than silently doing nothing.
- Reading a photo takes a few seconds longer than a spreadsheet — it is doing real work.

## 2026-09-01 — Fixed: your file not appearing in the upload box, and drag-and-drop in Inventory

Reported: trying to upload a document, and it doesn't come up.

Your file was almost certainly there — greyed out and unselectable. The upload box was only willing
to show three kinds of spreadsheet (`.csv`, `.xls`, `.xlsx`), so anything else looked like it did
not exist. The most common one to hit is `.xlsm`: Excel switches a workbook to that the moment it
contains a macro, and nothing about the data changes.

**The app could always read far more than it offered to.** Tested by making one file of each kind
and putting it through the real importer — all ten read perfectly, columns and all:

    .csv  .xls  .xlsx  .xlsm  .xlsb  .ods  .fods  .txt  .tsv  .dif

The upload box now offers exactly that list, and the list is generated from the same place the
importer checks against, so the two can never drift apart again.

**And you can now drag a file straight onto the Inventory page.** Anywhere on it — no need to find
the button. The screen shows a "Drop the file to import" panel while you are dragging, and letting
go opens the same preview you get from the button, so you still choose whether it updates costs or
adds new parts, and still see exactly what will change before anything is saved.

Two details that make it behave properly rather than just work:

- **Dropping slightly off-target no longer loses your place.** Without this, letting go over the
  side menu makes the browser abandon the app and open the raw file. A near miss now simply does
  nothing.
- **Dropping something it genuinely can't read says so, and says what to do.** A PDF or a photo of
  a supplier invoice is pointed at Purchases → Import, which is the screen that reads those.

Verified with 12 new automated tests (55 in total) covering every offered format end to end, plus
odd filenames — capital letters in the extension, dots and spaces in the name, and a `report.xlsx.pdf`
that must still be refused. The drag-and-drop itself needs a signed-in browser to click through, so
that part is worth a quick try at your end.

## 2026-09-01 — Quotations get per-item discounts and the GST inclusive/exclusive choice too

Asked for: the same treatment the sales invoice just had.

Quotations now work exactly like sales invoices do:

- **Every quoted line has its own Disc % box**, showing that line's amount underneath — and the
  original beside it when a discount is applied.
- **The same two GST buttons beside the rate** — *GST extra* (added on top of the rates you quote)
  and *GST included* (the rates already contain the tax) — with a line underneath saying which one
  you are on.
- **The totals show the working**: item discounts, subtotal, whole-quote discount, the real taxable
  value, GST, and the quotation total.
- **Reopening a quotation brings it all back**, and the printed quotation shows a Discount column
  and the correct tax split — both appearing only when the quotation actually uses them, so
  anything already saved prints unchanged.

**Converting a quotation into an invoice carries all of it across.** That mattered more than it
sounds: without it, a quote priced with GST included would have become an invoice priced with GST
extra — the customer's total would have looked identical while the tax printed on the invoice was
wrong.

**A difference worth knowing about, behind the scenes.** Unlike a sales invoice, a quotation's
totals are recalculated by the database itself and the save is refused if the figures don't match
its lines to the paisa. That check is a good thing — it is why a quotation can never quietly
disagree with its own line items — but it meant the calculation had to be taught both new ideas in
lockstep, and rounded in exactly the same order in both places, or every discounted quotation would
have been rejected. Both sides now round line by line, then total by total.

Checked end to end against the live database and undone immediately: a quotation of 2 x ₹1,000 with
10% off that line plus 1 x ₹500, a 5% whole-quote discount, priced GST-included at 18%, stored a
subtotal of ₹2,300.00, discount ₹115.00, GST ₹333.31 and a total of ₹2,185.00 — then converting it
produced an invoice carrying both the line discounts and the GST-included setting. A quotation saved
the old way, with neither of the new fields, produced exactly the figures it always did.

There are no saved quotations yet, so nothing existing was affected either way.

## 2026-09-01 — Fixed: editing a draft forced you to turn it into a real invoice

Reported: opening a draft to change it bills it as a final invoice; it should stay a draft until
you decide otherwise.

That was exactly what happened. Once a draft was reopened, the only way out of the dialog other
than Cancel was **Confirm Invoice** — so any change you wanted to make came bundled with billing
the customer. The code had assumed a saved sale was either a draft you were confirming or a live
invoice you were correcting, and simply didn't allow for the obvious third case: a draft you are
still working on.

Reopening a draft now offers **Save & Keep as Draft** alongside Confirm Invoice. Use it as often
as you like — change lines, prices, discounts, the GST setting, the customer — and the sale stays
parked. Nothing is billed until you press Confirm Invoice, which behaves exactly as it did before.

The footer now also spells this out while a draft is open, since it otherwise describes what
happens on confirmation: the "stays outstanding on their account" line is followed by a note that
saving it as a draft changes nothing on any account.

**What stays reserved and what doesn't:** saving a draft again re-reserves stock to match whatever
the draft now says — increase a quantity from 2 to 3 and the reservation follows — but it still
puts nothing on the customer's account. Checked against the live database and undone immediately:
parking a draft, editing and re-saving it as a draft, then confirming it. The customer's balance
stayed at zero through both draft saves and only moved when it was confirmed; stock went 9 to 7 to
6 as the quantity changed, and the draft kept a single set of lines rather than accumulating
copies.

A live invoice deliberately cannot be turned back into a draft. It has already been billed and is
already on someone's account, so parking it would quietly erase a real debt — correct it or delete
it instead.

## 2026-09-01 — New: bill with GST included in the price, or added on top

Asked for: GST should work both inclusive and exclusive.

Until now every sale assumed the rates you typed were **before** GST, and the tax was added on top.
A lot of counter trade works the other way round — the price you quote is the price the customer
pays, with the tax already inside it — and there was no way to record that.

There are now two buttons beside the GST rate:

- **GST extra** — the rates you type are before tax, and GST is added on top. This is what the app
  has always done, and it stays the default, so nothing changes unless you choose otherwise.
- **GST included** — the rates you type are what the customer pays. The tax is taken out of them,
  and the total is exactly the figure you typed.

A line under the buttons always states in words which one you are on, because that is the part that
is easy to get wrong. Switching between them never alters a single number you typed — it only
changes how those numbers are read.

The same sale, priced both ways at 18%:

                          GST extra      GST included
    Amount after discounts  2,185.00         2,185.00
    Taxable value           2,185.00         1,851.69
    GST (18%)                 393.30           333.31
    Total Payable           2,578.30         2,185.00

Either way, taxable value plus GST comes back to the total exactly.

The choice is saved with the invoice, so reopening it later brings it back, and the printed invoice
shows the correct split — with "included in the prices above" written next to the GST line when
that is what happened, so a customer is never left wondering whether tax was added twice.

**Two related fixes:**

- **Reopening an invoice to edit it used to reset GST to 18%**, whatever the invoice was actually
  saved at. A sale billed at 5% silently became an 18% one the moment you opened it. It now comes
  back at the rate it was saved with. (Invoices old enough to have no rate recorded still fall back
  to 18%, since there is nothing else to go on.)
- **The printed invoice worked its GST out backwards** from the total. That is only correct when
  tax was added on top, and would have shown zero tax on a GST-included invoice. It now uses the
  tax figure the sale actually recorded, keeping the old calculation only for invoices saved before
  that figure was stored — all of which were priced GST-extra.

Every existing invoice is untouched: all 10 read as GST-extra, which is how they were genuinely
priced, and they print exactly as before.

## 2026-08-30 — New: discount individual items on a sale, not just the whole bill

Reported: the discount applies to the entire invoice value, but it should be possible to discount
particular items.

An invoice could only carry one discount percentage applied to everything on it. That cannot say
"10% off the filters, full price on the pump", which is an ordinary thing to want — a customer
negotiates on one line, not on the bill.

**Every line on a sale now has its own Disc % box**, sitting between Rate and Amount where a
discount is read on paper. Type a percentage and that line's amount drops immediately, with the
original price shown struck through above it so the reduction is visible on the line itself rather
than only in the totals.

The invoice totals now show the work:

    Gross amount                     2,500.00
    Item discounts                    -200.00
    Subtotal after item discounts    2,300.00
    Whole-invoice discount (5%)       -115.00
    Taxable value                    2,185.00
    GST (18%)                          393.30
    Total Payable                    2,578.30

**The whole-invoice discount has not gone away** — it is still there, renamed so the two are not
confused, and it now applies on top of any per-item discounts. Leave it at 0 to discount items
only. The order matters and is fixed: each line is discounted first, then the whole-invoice
discount comes off what remains, and GST is charged on that. Doing it the other way round would
change the tax.

The lines above only appear when you actually use item discounts, so an invoice without them looks
and reads exactly as it always has.

**On the printed invoice**, a Discount column appears showing the percentage and the rupees off
each line, and the summary gains an "Item discounts" line — but only when the invoice uses them, so
existing invoices print unchanged. Reopening a sale to edit it brings each line's discount back
with it.

Sales returns and credit notes needed no change and are already correct: they work from the amount
actually charged for a line, which is now the discounted amount.

Every existing invoice is untouched — all 17 recorded line items read as "no item discount", and
their whole-invoice discounts behave exactly as before. Checked by saving a real invoice through
the live database and undoing it immediately: a 10%-off line of 2 x 1,000 stored 1,800 against a
2,000 gross, and the invoice total matched the arithmetic to the paisa.

## 2026-08-30 — One Import button again, and it now previews everything before saving

The cost-price update arrived as a second button sitting next to Import from File, which was one
button too many — both take a spreadsheet, and having to know which one to press before seeing
what is in the file is backwards. There is one **Import from File** button again.

**It reads your file once and works out what you probably want.** If most rows are parts you
already stock, it opens on "update cost prices". If most are unfamiliar, it opens on "add as new
parts". Either way it is only a suggestion — there are two buttons at the top of the dialog and you
can switch between them freely, with the preview following instantly. Nothing is written until you
press Apply.

Checked against your real inventory statement, which contains 229 rows: opened on your active
company it proposes updating costs (226 of the 229 are parts you already have), and on the company
that has almost none of them it proposes adding them as new parts instead.

**Adding parts now gets the same preview and the same tick boxes.** This is the bigger change.
Importing used to write everything in the file straight into your inventory the moment you picked
it — no list, no confirmation, and no check for parts you already had. On the file above that would
have created a second copy of 226 parts you already stock. Now you see every row before anything
happens, and **any row matching a part you already have starts unticked**, with the existing part
named next to it. You can still tick it deliberately if you really do want a second entry.

Both jobs work the same way once you are in the dialog: a list of every row, what will happen to
it, tick boxes to choose which ones, a tick-all box in the header, and a button that counts what is
actually selected.

## 2026-08-30 — New: update cost prices in bulk from a spreadsheet

Asked for: a spreadsheet holds the cost of each product, and only that column should be used.

Until now the Inventory import could only **add** parts, never update them — so uploading a price
list would have created a second copy of every part rather than repricing the ones you have. There
is now an **Update Costs from File** button next to Import, which does one thing only: change the
cost price of parts you already have.

**You choose which column holds the cost.** The first version tried to work it out from the column
heading and failed on your actual file — your cost column is headed "unite price", which no list of
expected names would ever contain, while two columns that *do* say "cost" ("ordering cost",
"holding cost") are stock-control figures, not what a part costs to buy. Guessing wrong here would
overwrite every price in the business, so the app now proposes a column and you confirm it. On your
file it proposes the right one on its own — "unite price", showing its first values (19200, 650,
8277) so you can check at a glance — and "Item code" for identifying the part. Both are dropdowns
you can change, and the preview updates instantly when you do.

**Nothing is saved until you have seen exactly what will change.** The preview lists every row: the
part it matched, the cost now, the new cost, and what will happen. Anything the file couldn't do is
listed first, because that is the part worth reading:

- **Not found** — no such part in this company. Skipped; never created as a new part.
- **Unclear** — the row matches more than one part, or two rows give different costs for the same
  part. Left alone rather than guessed at.
- **Already correct** — matched, but the cost in the file is the one already stored.

**And you choose which ones to apply.** Every row that would change has a tick box, all ticked to
begin with, plus a tick-all box in the header to clear them and pick out just the few you want. The
button counts what is actually selected ("Apply 12 cost update(s)"), unticked rows dim so you can
see at a glance what is being left out, and nothing you haven't ticked is touched. Rows that can't
be applied — not found, unclear, already correct — have no tick box at all, so there is never a
box that does nothing.

If most rows don't match, it now says so directly and asks whether you're on the right company —
because the usual cause is a price list belonging to a different company, not a bad file.

Details that matter:

- **Only the cost price changes.** Stock, selling price, MRP, location, name — all untouched.
- **It also corrects the purchase-batch cost**, the same as editing a part by hand does. That is
  what makes the new figure actually appear in Stock Value, and it is how you would fix the ₹0
  entries in bulk.
- **Your part numbers don't have to match exactly.** "JCB-H49", "jcb h49" and "JCBH49" are all read
  as the same part. If a row has no part number it falls back to the OEM number, then the name.
- **A price it can't read is never turned into ₹0.** Blank cells, "call for price", "N/A", and zero
  or negative values are reported as skipped and left alone.
- **Rupee signs and commas are fine**; a title row above your headings is fine; and the blank
  trailing columns a spreadsheet export leaves behind are hidden from the picker.
- If something fails partway through, you are told how many were updated before it stopped, and
  re-uploading the same file safely retries the rest.

Checked with 25 automated tests, several written directly against your real file's layout, plus a
dry run of the actual file against the live database: 229 rows read, the right columns chosen
automatically, and 228 of them matched to parts ready to update — with nothing written.

## 2026-08-26 — Draft an offer for a customer, worded to suit their segment

There's now a tag button beside each customer on the Customers page. It opens a small dialog that
shows their grade, reminds you what kind of offer suits that group, and drafts the message.

**You decide the offer; the app only writes it.** You type the terms — "5% off on orders above
₹20,000 through September", or "free delivery on the next order" — and it words them for that
particular customer. This is deliberate: an offer is a promise you have to honour once you send it,
so nothing you haven't written yourself will ever be promised. Give it something vague like "a small
discount" and the message stays vague rather than inventing a number for you.

**Your grades stay private.** The message never tells a customer they're Silver, or a Bargainer, or
that they're classified at all. The grade only decides the angle — a top customer is thanked and
offered priority, a discount-driven one is pointed at bundles rather than a deeper price cut, one
who's gone quiet is invited back warmly without any "we haven't seen you since February".

Every draft lands in an editable box for you to change before sending, and Copy puts it on your
clipboard for WhatsApp.

Works for any customer, including ungraded new ones — an opening offer to a new customer is often
exactly the point.

## 2026-08-26 — A sale on credit now has to name a customer

Cash sales are unchanged — pick nothing, it bills to the counter, and it stays as fast as it was.

But a sale that **isn't fully paid** now needs a named customer before it can be saved. Money owed by
"Walk-in Customer" can never be chased, never appears on anyone's ledger, and never counts towards
anyone's buying history. The existing **+ New** button beside the customer box adds one without
leaving the sale, so it costs a few seconds on the sales that actually need it.

You're told at the customer box the moment the sale becomes a credit sale, not after filling
everything in — and the Save button stays disabled until it's sorted.

This is also what makes the new customer grades work. Every unattributed credit sale was a customer
insight lost permanently; from now on the ones that matter get recorded against someone.

Worth knowing: six existing part-paid or unpaid walk-in invoices (about ₹18,925 of debt owed by
nobody identifiable) are all in the **bkgkj** test company, none in your real one. If you ever edit
one, it will now ask you to name the customer — which is the right fix for it anyway.

## 2026-08-26 — Customers are now graded Diamond / Gold / Silver, with behaviour flags

The Customers page now shows a segment against each customer, so you can tell at a glance who is
worth protecting and who is quietly costing you margin.

**The grades are cut from profit, not sales value** — and those two disagree. On real data in this
app, one customer brought in less revenue than the walk-in trade but nearly **twice the profit**.
Ranking by sales value would have pointed you at exactly the wrong customer to look after. This
works because every sale here is already traced back to the exact stock batch it came from, so the
true cost of each sale is known rather than guessed.

- 💎 **Diamond** — between them, the customers who earn the first half of all your profit
- 🥇 **Gold** — the next chunk, up to 80%
- 🥈 **Silver** — the remainder
- **New** — not enough history to grade honestly yet

Separately from the grade, any customer can carry flags, because your best customer can also be
your worst payer — and that is exactly the combination worth seeing rather than hiding behind one
label:

- **Defaulter** — has a bill unpaid past 45 days
- **Bargainer** — takes bigger discounts, or earns you thinner margin, than your house average
- **Dormant** — used to buy, nothing in 90 days

Every badge has a **"Why?"** link showing the actual numbers behind it — sales count, revenue,
profit, margin, average discount, last purchase date — plus what to do about it (protect them,
offer bundles instead of discounts, tighten credit, win them back). There is also a segment filter,
so "show me every Bargainer" is one click when you want to send that group an offer.

**Honest note on what you'll see today:** grading needs at least 2 recorded sales per customer, and
your active company has no sales recorded yet — so everyone will read "New" until you start
invoicing. That is deliberate. A grade invented from a single sale would send you to the wrong
customer with the wrong offer.

## 2026-08-26 — Fixed: scanning a photo of a supplier invoice did nothing

Reported: the details are not being read out of the picture.

The photo never reached the ERP. A photo from a phone camera is usually 3-10MB, and the way it has
to be packed up to send makes it about a third bigger again — roughly 5MB for an ordinary invoice
photo. The hosting platform refuses any request over 4.5MB and throws it away **before** your ERP
ever sees it. So there was nothing in the server logs to find, because nothing ever arrived. That
4.5MB ceiling belongs to the platform and can't be raised, so the photo has to be made smaller in
your browser before it is sent.

Confirmed directly against the live site: a 1MB request gets through; a 6MB one is refused outright.
And a realistic invoice photo measured 3.67MB, becoming 4.89MB once packed — just over the line,
which is exactly why it failed every time rather than sometimes.

**Photos are now shrunk in your browser before being sent** — down to 2200 pixels on the longest
side. The same realistic photo drops from 4.89MB to 1.04MB, comfortably inside the limit. 2200 is
deliberately larger than the 1600 used for catalogue product photos: part numbers and HSN codes are
the smallest print on an invoice and are exactly what has to stay readable.

The reading itself was never broken. Tested end to end against a scanned invoice, both AI services
read it perfectly — supplier name, GSTIN, invoice date, expected delivery, and every line item with
its part number, quantity, price and HSN code.

Two related things fixed at the same time:

- **PDFs can't be shrunk this way** (there is no picture to resize). A PDF over 4MB now tells you
  so, and suggests saving it smaller or photographing the invoice instead — rather than failing
  with nothing useful on screen.
- **Scanning is the slowest AI job in the app**, and that page had no time limit set, so the
  platform could cut a working scan short. It now gets the time the scan is actually allowed to
  take.

Duplicate detection is unaffected: the fingerprint that stops the same invoice being recorded twice
is still taken from your original file, before any shrinking, so the same document is still
recognised as the same document.

## 2026-08-26 — Fixed: Dashboard and Inventory showed two different stock values

Reported: Inventory said your stock was worth ₹8,77,964 and the Dashboard said ₹9,05,934 — same
242 parts, same moment, two different answers.

Both were right about the quantity and disagreed about the price. Inventory valued each part at
what its oldest unsold purchase batch actually cost; the Dashboard multiplied by the Cost Price
field typed into the part's record. They only match while those two agree — and on your data, two
parts had drifted far enough to put ₹27,970 between the same figure on two screens.

**Digging into which two, though, turned up something worth knowing.** Both of them —
`JCB-H49` (jcb hydraulic oil 20l, 3 in stock) and `SER-E37` (servo engine oil 5l, 8 in stock) —
have a purchase batch recorded at **₹0**, both entered on 30 July. So Inventory wasn't being more
accurate; it was treating ₹27,970 of oil sitting on your shelf as worth nothing. A zero there does
not mean the stock was free — it means nobody recorded what it cost when it was entered.

So the fix is two things:

1. **One shared definition of what stock is worth**, used by both screens, so they can never drift
   apart again. It values each part at its oldest unsold purchase batch, which is the real recorded
   purchase history, and falls back to the Cost Price field when there is no usable batch.
2. **A batch recorded at ₹0 now counts as "price not recorded", not as "free".** Those parts fall
   back to their Cost Price instead of being valued at nothing.

Both screens now show **₹9,05,436**. That is ₹498 below the Dashboard's old figure, and that ₹498
is correct: one part was genuinely bought at a different price than the Cost Price typed into its
record, and the real purchase price is the one that counts.

**Worth doing yourself:** those two oil entries still have no recorded purchase cost. Open each in
Inventory, edit it, and re-enter the Cost Price — that writes the correct cost back onto the
purchase batch, not just the part record.

**Also fixed on the Dashboard:** every rupee figure was grouped the international way (905,934)
rather than the Indian way (9,05,436) used everywhere else in the app. That was because the code
never said which country's formatting to use, so it followed the browser. All eleven money figures
on that screen — the KPI tiles, the attention items, the activity timeline and the chart tooltips —
now group like the rest of the app.

## 2026-08-26 — AI features now run twice a day instead of every time you open a page

Requested: the big AI results should be produced twice a day, not more.

Until now, every one of them regenerated from scratch each time you looked at it. Opening the
dashboard generated Business Insights and the Stock Reorder Recommendation again. Opening Reports
and clicking through the five tabs generated five separate summaries. Going back to a tab you had
already looked at generated it a sixth time. None of that produced anything new — it was the same
question about the same figures — but each one spent part of a small daily free allowance, so by
the time you actually wanted an answer, it could already be used up.

**Each AI panel now gets 2 real runs a day, per company.** Everything else shows the saved result,
instantly and at no cost. The report summaries count separately per report tab, because the P&L and
the GST summary are genuinely different questions.

How it behaves day to day:

- **Opening a page never uses up a run.** It shows the last saved answer. A new one is produced
  automatically only if nothing has been saved yet, or the saved one is more than 12 hours old —
  which naturally spaces the two runs across morning and evening.
- **The Refresh button still works and is still yours to press.** It deliberately spends one of the
  two. Once both are used, it tells you plainly that the next update is available tomorrow, instead
  of appearing to do nothing.
- **Every panel now shows when its answer was actually produced** ("Generated 9:04 AM", or
  "Generated yesterday, 7:30 PM"). Previously the time shown was simply whenever your browser had
  loaded the page, which was harmless when everything regenerated constantly and would have become
  untrue the moment results were saved.
- **A failed attempt costs you nothing.** The count only goes up when an answer is actually
  produced. And if the AI can't be reached, you now keep seeing your last good result with a short
  note saying it couldn't be refreshed — rather than the whole panel turning into a red error.
- **A saved report summary is never shown next to figures it wasn't written about.** Each summary
  remembers the numbers it described; if those have since changed, you are told so instead of being
  shown wording that no longer matches what's on screen.

Everything is stored per company, so the three companies never share results or allowances.

Checked against the real database with a new one-command test (`npx tsx scripts/ai-cache-check.ts`)
covering all of the above — including that a forced refresh genuinely cannot exceed the daily limit,
that the allowance resets on the next Indian calendar day rather than at UTC midnight, and that one
company's results are invisible to another. All 22 checks pass.

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
