import { listRows, getActiveCompanyId } from '@/lib/db';
import { invoiceBalanceDue } from '@/lib/invoice-balance';

type Product = { name: string; part_number: string; brand: string; category: string; current_stock: number; min_stock: number; cost_price: number };
type Customer = { balance: number };
type Supplier = { name: string; balance: number };
type Invoice = { id: string; customer: string; date: string; total: number; paid: number; status: string; settlement_write_off: number; };
type Quotation = { status: string };
type PurchaseOrder = { date: string; total: number; status: string };
type Expense = { category: string; amount: number; date: string };

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function sum(rows: Array<{ [key: string]: unknown }>, field: string): number {
  return rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
}

function countByStatus(rows: Array<{ status: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const s = r.status ?? 'unknown';
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return counts;
}

export async function buildBusinessDigest() {
  const companyId = await getActiveCompanyId();
  const products = (await listRows('products', companyId)) as unknown as Product[];
  const customers = (await listRows('customers', companyId)) as unknown as Customer[];
  const suppliers = (await listRows('suppliers', companyId)) as unknown as Supplier[];
  const invoices = (await listRows('invoices', companyId)) as unknown as Invoice[];
  const purchaseOrders = (await listRows('purchase_orders', companyId)) as unknown as PurchaseOrder[];
  const expenses = (await listRows('expenses', companyId)) as unknown as Expense[];
  const quotations = (await listRows('quotations', companyId)) as unknown as Quotation[];

  const invoices90 = invoices.filter((i) => i.date >= daysAgo(90));
  const invoices30 = invoices.filter((i) => i.date >= daysAgo(30));
  const invoices7 = invoices.filter((i) => i.date >= daysAgo(7));
  const po90 = purchaseOrders.filter((p) => p.date >= daysAgo(90));
  const po30 = purchaseOrders.filter((p) => p.date >= daysAgo(30));
  const expenses90 = expenses.filter((e) => e.date >= daysAgo(90));

  const lowStock = products
    .filter((p) => Number(p.min_stock) > 0 && Number(p.current_stock) <= Number(p.min_stock))
    .map((p) => ({ name: p.name, part_number: p.part_number, brand: p.brand, current_stock: p.current_stock, min_stock: p.min_stock }));

  const stockValue = products.reduce((t, p) => t + (Number(p.current_stock) || 0) * (Number(p.cost_price) || 0), 0);

  const expenseByCategory: Record<string, number> = {};
  for (const e of expenses90) {
    const cat = String(e.category ?? 'other');
    expenseByCategory[cat] = (expenseByCategory[cat] ?? 0) + (Number(e.amount) || 0);
  }

  return {
    generated_at: new Date().toISOString(),
    window_days: 90,
    inventory: {
      active_product_count: products.length,
      total_stock_units: products.reduce((t, p) => t + (Number(p.current_stock) || 0), 0),
      stock_value_at_cost: Math.round(stockValue),
      low_stock_count: lowStock.length,
      low_stock_items: lowStock.slice(0, 15),
    },
    customers: {
      total: customers.length,
      total_outstanding_receivables: sum(customers, 'balance'),
    },
    suppliers: {
      total: suppliers.length,
      total_outstanding_payables: sum(suppliers, 'balance'),
    },
    sales: {
      invoice_count_90d: invoices90.length,
      revenue_90d: sum(invoices90, 'total'),
      revenue_30d: sum(invoices30, 'total'),
      revenue_7d: sum(invoices7, 'total'),
      outstanding_receivables: invoices.reduce((t, i) => t + invoiceBalanceDue(i), 0),
      invoice_status_breakdown: countByStatus(invoices90),
      open_quotations: quotations.filter((q) => q.status !== 'accepted' && q.status !== 'rejected').length,
    },
    purchases: {
      order_count_90d: po90.length,
      spend_90d: sum(po90, 'total'),
      spend_30d: sum(po30, 'total'),
      purchase_order_status_breakdown: countByStatus(po90),
    },
    expenses: {
      total_90d: sum(expenses90, 'amount'),
      by_category_90d: expenseByCategory,
    },
  };
}

export type BusinessDigest = Awaited<ReturnType<typeof buildBusinessDigest>>;

/** How close a part is to its own reorder level: 0 = nothing left, 1 = exactly at the reorder
 *  level, above 1 = comfortably stocked. A part with no reorder level set has no scale to be
 *  measured against, so it only counts as urgent if it has actually run out. */
function stockRatio(p: Product): number {
  const reorder = Number(p.min_stock);
  if (!(reorder > 0)) return Number(p.current_stock) <= 0 ? 0 : Number.POSITIVE_INFINITY;
  return Number(p.current_stock) / reorder;
}

/** Include a margin above the reorder level so "about to run out" is visible, not just
 *  "already has". */
const REORDER_RATIO_CUTOFF = 1.5;

/** Well above the 8 items the model may return, so the shortlist never decides the answer for
 *  it — but bounded, because one company here holds 675 parts and 231 of them are out of stock. */
const MAX_CANDIDATES = 40;

export async function buildReorderDigest() {
  const companyId = await getActiveCompanyId();
  const products = (await listRows('products', companyId)) as unknown as Product[];

  // Deliberately not every product. The model may recommend at most 8 and is told to judge on
  // current stock against reorder level alone, so a comfortably-stocked part cannot change the
  // answer — but sending all of them made the request too large to answer at all: Groq rejects
  // outright above 8k tokens/minute on the free tier (a 242-part catalogue measured 9,738), and
  // Gemini ran past the request budget and was cut off. Both AI features failed at once because
  // of it. Sending only what could actually be recommended is what makes this answerable.
  const candidates = products
    .filter((p) => stockRatio(p) <= REORDER_RATIO_CUTOFF)
    .sort((a, b) => stockRatio(a) - stockRatio(b) || Number(a.current_stock) - Number(b.current_stock));

  const items = candidates.slice(0, MAX_CANDIDATES).map((p) => ({
    part_number: p.part_number,
    name: p.name,
    brand: p.brand,
    category: p.category,
    current_stock: p.current_stock,
    min_stock: p.min_stock,
    cost_price: p.cost_price,
  }));

  return {
    generated_at: new Date().toISOString(),
    has_sales_velocity_data: false,
    // Counted from the full catalogue, not from the shortlist — a trimmed list must never read
    // as a small business. See the scope note, which goes to the model verbatim.
    active_product_count: products.length,
    scope:
      `Only products that are out of stock, or within ${REORDER_RATIO_CUTOFF}x of their reorder level, are listed below. ` +
      'Every other product in the catalogue is comfortably stocked and was deliberately left out.',
    needs_attention_count: candidates.length,
    omitted_well_stocked_count: products.length - candidates.length,
    omitted_for_size_count: Math.max(0, candidates.length - items.length),
    products: items,
  };
}

export type ReorderDigest = Awaited<ReturnType<typeof buildReorderDigest>>;
