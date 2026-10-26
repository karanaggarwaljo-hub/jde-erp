'use client';

/**
 * Home: the first screen after signing in.
 *
 * The owner found the ERP cluttered and asked for it to be easy enough for a school child to use.
 * Home now starts with one big button for each everyday job. Each button opens its form straight
 * away on the screen that owns it, and that screen comes back here once the entry is saved. Below
 * the buttons are the four figures that matter at the counter, then what needs attention, then the
 * activity calendar the owner asked to keep big.
 *
 * What it used to show and where that went: eight figure boxes became the four below (the rest are
 * on Reports); the long low-stock list is on Stock and What to Order; the recent-activity table is
 * the Day Book's job.
 */

import Link from 'next/link';
import { useMemo } from 'react';
import {
  ShoppingCart,
  HandCoins,
  Truck,
  Banknote,
  Wallet,
  Search,
  PackageX,
  AlertTriangle,
  Clock,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { invoiceBalanceDue, isInvoiceOpen } from '@/lib/invoice-balance';
import { isCountedSale } from '@/lib/sales-types';
import { entryLink } from '@/lib/entry-intent';
import { wholeMoney } from '@/lib/money';
import { useCompany } from '@/components/CompanyProvider';
import ActivityCalendar from '@/components/ActivityCalendar';
import type { ActivityEvent } from '@/lib/activity-calendar';
import { shopDay } from '@/lib/logbook';

type Product = { id: string; part_number: string; name: string; current_stock: number; min_stock: number };
type Customer = { id: string; balance: number };
type Supplier = { id: string; name: string; balance: number };
type Invoice = { id: string; customer: string; date: string; total: number; paid: number; settlement_write_off: number; status: string };
type Dated = { id: string; date: string };

/** In the order a counter day usually runs: selling and taking money first, then buying and paying.
 *  "in" and "out" colour the button the same way the Day Book colours money in and money out. */
const HOME_ACTIONS: Array<{ label: string; hint: string; href: string; icon: LucideIcon; tone: 'in' | 'out' | 'find' }> = [
  { label: 'Make a bill', hint: 'Sell parts to a customer', href: entryLink('sale', 'home'), icon: ShoppingCart, tone: 'in' },
  { label: 'Money received', hint: 'A customer paid you', href: entryLink('payment-in', 'home'), icon: HandCoins, tone: 'in' },
  { label: 'Buy stock', hint: 'Parts came in from a supplier', href: entryLink('purchase', 'home'), icon: Truck, tone: 'out' },
  { label: 'Pay a supplier', hint: 'You paid for stock', href: entryLink('supplier-payment', 'home'), icon: Banknote, tone: 'out' },
  { label: 'Add an expense', hint: 'Rent, salary, freight', href: entryLink('expense', 'home'), icon: Wallet, tone: 'out' },
  { label: 'Find a part', hint: 'Check its stock and price', href: '/inventory?find=1', icon: Search, tone: 'find' },
];

/** The shop's day (India time), not the UTC one, which is a day behind until 5:30 am. */
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return shopDay(d);
}

export default function HomePage() {
  const { configError, activeCompany } = useCompany();
  const { rows: products, error: productsError } = useCompanyTable<Product>('products');
  const { rows: customers, error: customersError } = useCompanyTable<Customer>('customers');
  const { rows: suppliers, error: suppliersError } = useCompanyTable<Supplier>('suppliers');
  const { rows: invoices, error: invoicesError } = useCompanyTable<Invoice>('invoices');
  // Only for the activity calendar: a purchase, an expense or a quotation is a day's work too.
  const { rows: purchaseOrders, error: purchaseOrdersError } = useCompanyTable<Dated>('purchase_orders');
  const { rows: quotations, error: quotationsError } = useCompanyTable<Dated>('quotations');
  const { rows: expenses, error: expensesError } = useCompanyTable<Dated>('expenses');

  // Every figure on this screen is summed from the tables above. If any of them failed to load, the
  // sums are of whatever did arrive, and a smaller number reads exactly like a quieter day rather
  // than like missing data. Say so instead of drawing them.
  const dataError = productsError ?? customersError ?? suppliersError ?? invoicesError
    ?? purchaseOrdersError ?? quotationsError ?? expensesError;

  const today = shopDay(new Date());
  const headerDate = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Sales that happened: a parked draft (a job card's bill while the machine is in) and a cancelled
  // bill are not sales.
  const soldToday = invoices
    .filter((invoice) => isCountedSale(invoice) && invoice.date === today)
    .reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
  // Only what is actually owed. A balance below zero is money paid in advance, and adding it in
  // would show a supplier advance as "₹-4,000 to pay".
  const owed = (balance: number) => Math.max(0, Number(balance || 0));
  const ahead = (balance: number) => Math.max(0, -Number(balance || 0));
  const toCollect = customers.reduce((sum, customer) => sum + owed(customer.balance), 0);
  const toPay = suppliers.reduce((sum, supplier) => sum + owed(supplier.balance), 0);
  const paidAheadToSuppliers = suppliers.reduce((sum, supplier) => sum + ahead(supplier.balance), 0);
  const paidAheadByCustomers = customers.reduce((sum, customer) => sum + ahead(customer.balance), 0);
  const owingCustomers = customers.filter((customer) => Number(customer.balance) > 0).length;
  const owedSuppliers = suppliers.filter((supplier) => Number(supplier.balance) > 0).length;
  const lowStock = products.filter((p) => Number(p.min_stock) > 0 && Number(p.current_stock) <= Number(p.min_stock));

  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const nameList = (names: string[], shown = 2) =>
    names.length <= shown ? names.join(', ') : `${names.slice(0, shown).join(', ')} and ${names.length - shown} more`;

  const figures = [
    { label: 'Sold today', value: `₹${wholeMoney(soldToday)}`, note: 'Bills written today', href: '/daybook', tone: '' },
    {
      label: 'To collect',
      value: `₹${wholeMoney(toCollect)}`,
      note: owingCustomers > 0
        ? `${plural(owingCustomers, 'customer')} ${owingCustomers === 1 ? 'owes' : 'owe'} you`
        : paidAheadByCustomers > 0 ? `Nobody owes you · ₹${wholeMoney(paidAheadByCustomers)} paid ahead` : 'Nobody owes you',
      href: '/customers',
      tone: toCollect > 0 ? 'warn' : '',
    },
    {
      label: 'To pay',
      value: `₹${wholeMoney(toPay)}`,
      note: owedSuppliers > 0
        ? `You owe ${plural(owedSuppliers, 'supplier')}`
        : paidAheadToSuppliers > 0 ? `You owe nobody · ₹${wholeMoney(paidAheadToSuppliers)} paid ahead` : 'You owe nobody',
      href: '/suppliers',
      tone: '',
    },
    { label: 'To reorder', value: plural(lowStock.length, 'part'), note: 'At or below their reorder level', href: '/stock-planning', tone: lowStock.length > 0 ? 'bad' : '' },
  ];

  // ── Needs attention ─────────────────────────────────────────────────────────────────────────
  // Every item is counted off rows this page has already loaded. Nothing is estimated: there is no
  // due date anywhere in this system, so an unpaid bill is described by how long it has been unpaid.
  const unpaidAgeCutoff = daysAgo(30);
  const oldUnpaid = invoices
    .filter((invoice) => isInvoiceOpen(invoice) && invoice.date < unpaidAgeCutoff)
    .sort((a, b) => a.date.localeCompare(b.date));
  const oldUnpaidAmount = oldUnpaid.reduce((sum, invoice) => sum + invoiceBalanceDue(invoice), 0);
  const oldUnpaidCustomers = Array.from(new Set(oldUnpaid.map((invoice) => invoice.customer).filter(Boolean)));
  const outOfStock = products.filter((p) => Number(p.current_stock || 0) <= 0);
  // Parts that still have some stock but have fallen to their own reorder level. Kept apart from the
  // empty ones so a part is never counted in two items at once.
  const runningLow = lowStock.filter((p) => Number(p.current_stock || 0) > 0);

  const attentionItems = [
    oldUnpaid.length > 0
      ? {
          key: 'unpaid-invoices',
          tone: 'danger',
          icon: Clock,
          title: `${plural(oldUnpaid.length, 'bill')} unpaid for more than 30 days`,
          detail: `₹${wholeMoney(oldUnpaidAmount)} to collect from ${nameList(oldUnpaidCustomers)}`,
          href: '/customers',
          action: 'Collect',
        }
      : null,
    outOfStock.length > 0
      ? {
          key: 'out-of-stock',
          tone: 'danger',
          icon: PackageX,
          title: `${plural(outOfStock.length, 'part')} out of stock`,
          detail: `None left of ${nameList(outOfStock.map((p) => p.name))}`,
          href: '/inventory',
          action: 'See parts',
        }
      : null,
    runningLow.length > 0
      ? {
          key: 'running-low',
          tone: 'warning',
          icon: AlertTriangle,
          title: `${plural(runningLow.length, 'part')} running low`,
          detail: nameList(runningLow.map((p) => `${p.name}: ${p.current_stock} left`)),
          href: '/stock-planning',
          action: 'What to order',
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  /** One entry per record actually entered, keyed on the date written on it. */
  const activityEvents = useMemo<ActivityEvent[]>(() => [
    ...invoices.filter((inv) => inv.date).map((inv) => ({ day: inv.date, kind: 'sale' as const })),
    ...purchaseOrders.filter((po) => po.date).map((po) => ({ day: po.date, kind: 'purchase' as const })),
    ...expenses.filter((expense) => expense.date).map((expense) => ({ day: expense.date, kind: 'expense' as const })),
    ...quotations.filter((quote) => quote.date).map((quote) => ({ day: quote.date, kind: 'quotation' as const })),
  ], [invoices, purchaseOrders, expenses, quotations]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Home</h1>
          <p className="page-subtitle">{[headerDate, activeCompany?.name].filter(Boolean).join(' · ')}</p>
        </div>
      </div>

      <section className="home-actions" aria-labelledby="home-actions-heading">
        <h2 id="home-actions-heading" className="home-heading">What do you want to do?</h2>
        <div className="home-action-grid">
          {HOME_ACTIONS.map(({ label, hint, href, icon: Icon, tone }) => (
            <Link key={label} href={href} prefetch={false} className={`home-action home-action-${tone}`}>
              <span className="home-action-icon"><Icon size={26} aria-hidden="true" /></span>
              <span className="home-action-text"><strong>{label}</strong><small>{hint}</small></span>
            </Link>
          ))}
        </div>
      </section>

      {configError && (
        <div className="alert alert-danger mb-4" role="alert">
          Can&apos;t reach the database right now — {configError}
        </div>
      )}

      {!configError && dataError && (
        <div className="alert alert-danger mb-4" role="alert">
          Some of this company&apos;s records could not be loaded, so the figures below would not be the
          whole picture — {dataError}
        </div>
      )}

      {!configError && !dataError && (
        <>
          <div className="home-figures">
            {figures.map((figure) => (
              <Link key={figure.label} href={figure.href} prefetch={false} className={`home-figure${figure.tone ? ` ${figure.tone}` : ''}`}>
                <span className="home-figure-label">{figure.label}</span>
                <strong className="home-figure-value">{figure.value}</strong>
                <small>{figure.note}</small>
              </Link>
            ))}
          </div>

          <section className="card mb-6" aria-labelledby="home-attention-heading">
            <h2 id="home-attention-heading" className="home-heading">Needs attention</h2>
            {attentionItems.length === 0 ? (
              <p className="text-muted">Nothing right now. No bill has been unpaid for more than 30 days and every part has stock.</p>
            ) : (
              <div className="home-attention-list">
                {attentionItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.key} className={`home-attention ${item.tone}`}>
                      <span className="home-attention-icon"><Icon size={18} aria-hidden="true" /></span>
                      <div className="home-attention-text">
                        <strong>{item.title}</strong>
                        <small>{item.detail}</small>
                      </div>
                      <Link href={item.href} prefetch={false} className="btn btn-secondary btn-sm">{item.action} <ArrowRight size={14} /></Link>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Full width and big, as the owner asked for it. */}
          <ActivityCalendar events={activityEvents} today={today} />
        </>
      )}
    </div>
  );
}
