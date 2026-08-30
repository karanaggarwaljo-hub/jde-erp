/**
 * Grouping customers by what they are actually worth, and how they behave.
 *
 * Kept out of the Customers page deliberately, same reasoning as lib/import-matching.ts: this is
 * the logic with money behind it (which customer gets an offer, whose credit gets tightened), and
 * being pure means scripts/customer-insights-check.ts can exercise it against real data.
 *
 * The important thing this does that a sales report cannot: it ranks by **gross profit**, not
 * revenue. Those give opposite answers. On real data from this app, one customer brought in less
 * revenue than the walk-in trade but nearly twice the profit — ranking by revenue would have
 * pointed at exactly the wrong customer to look after. That is only possible because every sale
 * here is traced back to the FIFO batch it came from (jde_stock_consumptions), so the true cost
 * of each line is known rather than estimated from a list price.
 */

export type CustomerTier = 'diamond' | 'gold' | 'silver' | 'new';
export type CustomerFlag = 'defaulter' | 'bargainer' | 'dormant';

/** Only the invoice fields this needs, so callers can pass their own richer rows. */
export type InsightsInvoice = {
  id: string;
  /** Invoices store the customer's NAME, not an id — matching is by name (see matchKey below). */
  customer: string;
  date: string;
  total: number;
  paid: number;
  status: string;
  discount_amount?: number | null;
};

export type InsightsInvoiceItem = { id: string; invoice_id: string; line_total: number };

/** One FIFO draw against an invoice line — what that line genuinely cost. */
export type InsightsConsumption = { invoice_item_id: string; qty: number; unit_cost: number };

export type InsightsCustomer = { id: string; name: string; balance?: number | null };

export type CustomerInsight = {
  customerId: string;
  name: string;
  tier: CustomerTier;
  flags: CustomerFlag[];
  /** Plain-English justification for the tier and every flag, for showing under the badge. */
  reasons: string[];
  orderCount: number;
  revenue: number;
  grossProfit: number;
  /** Null when revenue is zero — an undefined margin, not a 0% one. */
  marginPercent: number | null;
  avgOrderValue: number;
  avgDiscountPercent: number;
  /** Share of the company's total gross profit, which is what the tiers are cut from. */
  profitSharePercent: number;
  lastPurchaseDate: string | null;
  daysSinceLastPurchase: number | null;
  outstanding: number;
  oldestUnpaidDays: number | null;
  /** False when there is too little history to grade honestly — tier is then 'new'. */
  graded: boolean;
};

/**
 * Thresholds, gathered here rather than scattered through the logic so they can be argued with.
 * These are starting points chosen to be defensible, not tuned against real trading history —
 * there isn't enough of it yet. Revisit once a few months of sales exist.
 */
export const INSIGHT_RULES = {
  /** Below this many completed sales, a tier would be a guess dressed as a grade. */
  minOrdersToGrade: 2,
  /** Cumulative-profit cut points (classic ABC analysis, three bands instead of four). */
  diamondProfitShare: 0.5,
  goldProfitShare: 0.8,
  /** An unpaid invoice older than this marks a Defaulter. jde_customers has no per-customer
   *  payment-terms column, so this is one house-wide assumption rather than a real term. */
  overdueDays: 45,
  /** No purchase in this long, from someone who used to buy, reads as gone quiet. */
  dormantDays: 90,
  /** A Bargainer discounts at least this many points above the house average... */
  bargainerDiscountGapPoints: 2,
  /** ...and at least this much in absolute terms, so a 0.5% house average can't make
   *  an ordinary 2% discount look like hard bargaining. */
  bargainerMinDiscountPercent: 3,
  /** Or earns this many points less margin than the house average, which is the same
   *  price pressure showing up in the cost line instead of the discount line. */
  bargainerMarginGapPoints: 5,
} as const;

/** Invoices carry the customer's name as typed, so matching tolerates case and spacing drift. */
function matchKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function daysBetween(fromIso: string, toIso: string): number | null {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * @param today ISO date (YYYY-MM-DD), passed in rather than read from the clock so the same
 *              inputs always produce the same output — and so tests can pin a date.
 */
export function buildCustomerInsights(input: {
  customers: InsightsCustomer[];
  invoices: InsightsInvoice[];
  items: InsightsInvoiceItem[];
  consumptions: InsightsConsumption[];
  today: string;
}): CustomerInsight[] {
  const { customers, invoices, items, consumptions, today } = input;

  // Cost per invoice line, then per invoice. A line with no consumption rows contributes no
  // cost — that is a real gap (an old line predating FIFO tracking, or a non-stock item) and is
  // left as zero cost rather than guessed at, which would inflate or invent profit.
  const costByItemId = new Map<string, number>();
  for (const consumption of consumptions) {
    const previous = costByItemId.get(consumption.invoice_item_id) ?? 0;
    costByItemId.set(consumption.invoice_item_id, previous + Number(consumption.qty) * Number(consumption.unit_cost));
  }

  const costByInvoiceId = new Map<string, number>();
  const linesByInvoiceId = new Map<string, number>();
  for (const item of items) {
    costByInvoiceId.set(item.invoice_id, (costByInvoiceId.get(item.invoice_id) ?? 0) + (costByItemId.get(item.id) ?? 0));
    linesByInvoiceId.set(item.invoice_id, (linesByInvoiceId.get(item.invoice_id) ?? 0) + Number(item.line_total ?? 0));
  }

  // Drafts are parked, not sold — they reserve stock but bill nothing, so they must not count
  // as purchase history or the tiers would reward parking quotes.
  const liveInvoices = invoices.filter((invoice) => invoice.status !== 'draft');

  const byCustomerKey = new Map<string, InsightsInvoice[]>();
  for (const invoice of liveInvoices) {
    const key = matchKey(invoice.customer ?? '');
    if (!key) continue;
    const bucket = byCustomerKey.get(key);
    if (bucket) bucket.push(invoice);
    else byCustomerKey.set(key, [invoice]);
  }

  // House averages, computed across named customers only — the anonymous walk-in trade is not a
  // customer and including it would drag the benchmark every real customer is judged against.
  const namedKeys = new Set(customers.map((customer) => matchKey(customer.name)));
  let houseRevenue = 0;
  let houseProfit = 0;
  let houseGrossBeforeDiscount = 0;
  let houseDiscount = 0;
  for (const [key, customerInvoices] of byCustomerKey) {
    if (!namedKeys.has(key)) continue;
    for (const invoice of customerInvoices) {
      const revenue = Number(invoice.total ?? 0);
      const discount = Number(invoice.discount_amount ?? 0);
      houseRevenue += revenue;
      houseProfit += revenue - (costByInvoiceId.get(invoice.id) ?? 0);
      houseDiscount += discount;
      houseGrossBeforeDiscount += revenue + discount;
    }
  }
  const houseMarginPercent = houseRevenue > 0 ? (houseProfit / houseRevenue) * 100 : 0;
  const houseDiscountPercent = houseGrossBeforeDiscount > 0 ? (houseDiscount / houseGrossBeforeDiscount) * 100 : 0;

  const rows = customers.map((customer) => {
    const customerInvoices = byCustomerKey.get(matchKey(customer.name)) ?? [];

    let revenue = 0;
    let cost = 0;
    let discount = 0;
    let grossBeforeDiscount = 0;
    let outstanding = 0;
    let lastPurchaseDate: string | null = null;
    let oldestUnpaidDate: string | null = null;

    for (const invoice of customerInvoices) {
      const invoiceRevenue = Number(invoice.total ?? 0);
      const invoiceDiscount = Number(invoice.discount_amount ?? 0);
      revenue += invoiceRevenue;
      cost += costByInvoiceId.get(invoice.id) ?? 0;
      discount += invoiceDiscount;
      grossBeforeDiscount += invoiceRevenue + invoiceDiscount;

      const due = Math.max(invoiceRevenue - Number(invoice.paid ?? 0), 0);
      if (due > 0) {
        outstanding += due;
        if (!oldestUnpaidDate || invoice.date < oldestUnpaidDate) oldestUnpaidDate = invoice.date;
      }
      if (!lastPurchaseDate || invoice.date > lastPurchaseDate) lastPurchaseDate = invoice.date;
    }

    const grossProfit = revenue - cost;
    const orderCount = customerInvoices.length;

    return {
      customerId: customer.id,
      name: customer.name,
      orderCount,
      revenue: round2(revenue),
      grossProfit: round2(grossProfit),
      marginPercent: revenue > 0 ? round2((grossProfit / revenue) * 100) : null,
      avgOrderValue: orderCount > 0 ? round2(revenue / orderCount) : 0,
      avgDiscountPercent: grossBeforeDiscount > 0 ? round2((discount / grossBeforeDiscount) * 100) : 0,
      lastPurchaseDate,
      daysSinceLastPurchase: lastPurchaseDate ? daysBetween(lastPurchaseDate, today) : null,
      outstanding: round2(outstanding),
      oldestUnpaidDays: oldestUnpaidDate ? daysBetween(oldestUnpaidDate, today) : null,
    };
  });

  // Tiers are cut from cumulative share of profit, richest first — so "Diamond" means "the
  // customers who between them earn the first half of everything you make", which is a real
  // statement about the business rather than an arbitrary rupee threshold that ages badly.
  const gradable = rows
    .filter((row) => row.orderCount >= INSIGHT_RULES.minOrdersToGrade && row.grossProfit > 0)
    .sort((a, b) => b.grossProfit - a.grossProfit);

  const gradableProfitTotal = gradable.reduce((sum, row) => sum + row.grossProfit, 0);
  const tierByCustomerId = new Map<string, CustomerTier>();
  let cumulative = 0;
  for (const row of gradable) {
    const shareBefore = gradableProfitTotal > 0 ? cumulative / gradableProfitTotal : 1;
    cumulative += row.grossProfit;
    tierByCustomerId.set(
      row.customerId,
      shareBefore < INSIGHT_RULES.diamondProfitShare ? 'diamond' : shareBefore < INSIGHT_RULES.goldProfitShare ? 'gold' : 'silver'
    );
  }

  return rows.map((row) => {
    const tier = tierByCustomerId.get(row.customerId) ?? 'new';
    const graded = tier !== 'new';
    const profitSharePercent = houseProfit > 0 ? round2((row.grossProfit / houseProfit) * 100) : 0;

    const flags: CustomerFlag[] = [];
    const reasons: string[] = [];

    if (graded) {
      reasons.push(`Brings in ₹${Math.round(row.grossProfit).toLocaleString('en-IN')} profit — ${profitSharePercent}% of the total from named customers.`);
    } else if (row.orderCount === 0) {
      reasons.push('No sales recorded against this customer yet.');
    } else {
      reasons.push(`Only ${row.orderCount} sale${row.orderCount === 1 ? '' : 's'} so far — needs at least ${INSIGHT_RULES.minOrdersToGrade} before a grade means anything.`);
    }

    if (row.outstanding > 0 && (row.oldestUnpaidDays ?? 0) >= INSIGHT_RULES.overdueDays) {
      flags.push('defaulter');
      reasons.push(`₹${Math.round(row.outstanding).toLocaleString('en-IN')} unpaid, oldest bill ${row.oldestUnpaidDays} days old.`);
    }

    const discountGap = row.avgDiscountPercent - houseDiscountPercent;
    const marginGap = row.marginPercent === null ? 0 : houseMarginPercent - row.marginPercent;
    const bargainsOnDiscount =
      discountGap >= INSIGHT_RULES.bargainerDiscountGapPoints && row.avgDiscountPercent >= INSIGHT_RULES.bargainerMinDiscountPercent;
    const bargainsOnMargin = row.marginPercent !== null && marginGap >= INSIGHT_RULES.bargainerMarginGapPoints;
    if (row.orderCount > 0 && (bargainsOnDiscount || bargainsOnMargin)) {
      flags.push('bargainer');
      reasons.push(
        bargainsOnDiscount
          ? `Averages ${row.avgDiscountPercent}% discount against a house average of ${round2(houseDiscountPercent)}%.`
          : `Earns ${row.marginPercent}% margin against a house average of ${round2(houseMarginPercent)}%.`
      );
    }

    if (row.orderCount > 0 && (row.daysSinceLastPurchase ?? 0) >= INSIGHT_RULES.dormantDays) {
      flags.push('dormant');
      reasons.push(`Nothing bought in ${row.daysSinceLastPurchase} days — last was ${row.lastPurchaseDate}.`);
    }

    return { ...row, tier, graded, profitSharePercent, flags, reasons };
  });
}

/** What to show on the badge. Kept beside the rules so wording and logic can't drift apart. */
export const TIER_LABELS: Record<CustomerTier, string> = {
  diamond: 'Diamond',
  gold: 'Gold',
  silver: 'Silver',
  new: 'New',
};

export const FLAG_LABELS: Record<CustomerFlag, string> = {
  defaulter: 'Defaulter',
  bargainer: 'Bargainer',
  dormant: 'Dormant',
};

/** The point of the whole exercise: what to actually do about each group. */
export const TIER_ACTIONS: Record<CustomerTier, string> = {
  diamond: 'Protect these — priority stock and first call on new arrivals.',
  gold: 'Steady earners. Worth growing with the odd targeted offer.',
  silver: 'Small or occasional. Low effort, low priority.',
  new: 'Not enough history yet to judge.',
};

export const FLAG_ACTIONS: Record<CustomerFlag, string> = {
  defaulter: 'Tighten credit before selling more.',
  bargainer: 'Offer bundles and volume deals, not deeper discounts.',
  dormant: 'Worth a win-back call or offer.',
};
