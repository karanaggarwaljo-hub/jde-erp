/**
 * What each part actually earned: sales, what those sales cost, and the profit between them —
 * by part, category, brand, customer or supplier. The owner asked to be able to see the cost and
 * financial analysis of a product; until now the only profit figure was one line on the P&L.
 *
 * Every figure is built from records, never estimated:
 *
 *   Sales     Each invoice line's share of what the customer was charged before GST — after the
 *             line's own discount, after its share of any whole-bill discount, and with GST taken
 *             out of GST-inclusive prices (lib/invoice-figures.ts, the same numbers the invoice
 *             prints). Less what came back: a returned quantity takes its share of the line out.
 *
 *   Cost      What the goods that left the shelf cost, batch by batch (jde_stock_consumptions —
 *             the FIFO draws the sale made). A resellable return puts its goods back on the shelf
 *             and its draws are undone in the database; a damaged return does not, so its cost
 *             stays a cost — the shop paid for a part it can no longer sell.
 *
 *   Unknown   A line with no recorded cost (a free-text line with no stocked part behind it) has
 *             no profit. It is counted and shown, never valued at zero — that would report the
 *             whole line as profit.
 *
 * Pure: the server gathers the records (lib/db getProfitSource), this does the arithmetic, and the
 * screen only groups and sorts.
 */

import { invoiceFigures } from './invoice-figures';

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const round2 = (value: number) => Math.round(value * 100) / 100;

export type ProfitInvoice = {
  id: string;
  date: string;
  customer: string | null;
  total: number | string;
  discount_amount?: number | string | null;
  gst_amount?: number | string | null;
  gst_mode?: string | null;
};
export type ProfitItem = {
  id: string;
  invoice_id: string;
  product_id: string | null;
  part_number?: string | null;
  name: string;
  qty: number | string;
  line_total: number | string;
  discount_percent?: number | string | null;
  discount_amount?: number | string | null;
};
export type ProfitReturnItem = { invoice_item_id: string; qty: number | string };
export type ProfitConsumption = { invoice_item_id: string; layer_id: string | null; qty: number | string; unit_cost: number | string };
export type ProfitPart = { id: string; part_number?: string | null; name: string; category?: string | null; brand?: string | null };
/** Which supplier a stock batch came from (its purchase order's supplier), by batch id. */
export type BatchSupplier = Record<string, string>;

export type ProfitLine = {
  itemId: string;
  invoiceId: string;
  date: string;
  customer: string;
  productId: string | null;
  partNumber: string;
  name: string;
  category: string;
  brand: string;
  /** Sold less returned. */
  qty: number;
  /** Before GST, after every discount, less returns. */
  sales: number;
  /** Null when the line has no recorded cost. */
  cost: number | null;
  /** Where the cost came from: supplier name → quantity drawn from that supplier's batches. */
  suppliers: Array<{ supplier: string; qty: number; cost: number }>;
};

export const NO_SUPPLIER = 'Opening stock / no purchase';
export const WALK_IN = 'Walk-in Customer';
export const UNCATEGORISED = 'Uncategorised';
export const NO_BRAND = 'No brand';

export function profitLines(input: {
  invoices: ProfitInvoice[];
  items: ProfitItem[];
  returnItems: ProfitReturnItem[];
  consumptions: ProfitConsumption[];
  parts: ProfitPart[];
  batchSuppliers: BatchSupplier;
}): ProfitLine[] {
  const partsById = new Map(input.parts.map((part) => [part.id, part]));
  const itemsByInvoice = new Map<string, ProfitItem[]>();
  for (const item of input.items) {
    const list = itemsByInvoice.get(item.invoice_id) ?? [];
    list.push(item);
    itemsByInvoice.set(item.invoice_id, list);
  }
  const returnedQty = new Map<string, number>();
  for (const back of input.returnItems) returnedQty.set(back.invoice_item_id, (returnedQty.get(back.invoice_item_id) ?? 0) + num(back.qty));
  const drawsByItem = new Map<string, ProfitConsumption[]>();
  for (const draw of input.consumptions) {
    const list = drawsByItem.get(draw.invoice_item_id) ?? [];
    list.push(draw);
    drawsByItem.set(draw.invoice_item_id, list);
  }

  const lines: ProfitLine[] = [];
  for (const invoice of input.invoices) {
    const items = itemsByInvoice.get(invoice.id) ?? [];
    if (items.length === 0) continue;
    // A return rewrites the bill's header — its total, discount and GST shrink to cover only the
    // goods the customer kept (jde_create_sales_return) — but leaves its lines as originally sold.
    // So the lines are scaled to what was kept before the header's figures are applied to them;
    // taking the returned share off afterwards as well would count the return twice.
    const kept = items.map((item) => {
      const soldQty = num(item.qty);
      const backQty = Math.min(soldQty, returnedQty.get(item.id) ?? 0);
      const keptShare = soldQty > 0 ? (soldQty - backQty) / soldQty : 0;
      return { item, keptQty: soldQty - backQty, keptLineTotal: num(item.line_total) * keptShare, keptDiscount: num(item.discount_amount) * keptShare };
    });
    // What was paid does not change what was sold; only the taxable value is used here.
    const figures = invoiceFigures(
      { ...invoice, paid: 0 },
      kept.map((entry) => ({ line_total: entry.keptLineTotal, discount_amount: entry.keptDiscount, discount_percent: entry.item.discount_percent })),
    );
    // The bill's taxable value spread over its lines by what each kept line was worth.
    const toTaxable = figures.subtotal > 0 ? figures.netTaxableValue / figures.subtotal : 0;

    for (const { item, keptQty, keptLineTotal } of kept) {
      const sales = keptLineTotal * toTaxable;

      const draws = drawsByItem.get(item.id) ?? [];
      let cost: number | null;
      const bySupplier = new Map<string, { qty: number; cost: number }>();
      if (draws.length > 0) {
        cost = 0;
        for (const draw of draws) {
          const drawCost = num(draw.qty) * num(draw.unit_cost);
          cost += drawCost;
          const supplier = (draw.layer_id && input.batchSuppliers[draw.layer_id]) || NO_SUPPLIER;
          const entry = bySupplier.get(supplier) ?? { qty: 0, cost: 0 };
          entry.qty += num(draw.qty);
          entry.cost += drawCost;
          bySupplier.set(supplier, entry);
        }
      } else if (item.product_id && keptQty <= 0) {
        // Everything came back in resellable condition: the draws were undone, nothing was lost.
        cost = 0;
      } else {
        cost = null;
      }

      const part = item.product_id ? partsById.get(item.product_id) : undefined;
      lines.push({
        itemId: item.id,
        invoiceId: invoice.id,
        date: invoice.date,
        customer: (invoice.customer ?? '').trim() || WALK_IN,
        productId: item.product_id,
        partNumber: (part?.part_number ?? item.part_number ?? '').trim(),
        name: (part?.name ?? item.name ?? '').trim() || 'Unnamed line',
        category: (part?.category ?? '').trim() || UNCATEGORISED,
        brand: (part?.brand ?? '').trim() || NO_BRAND,
        qty: keptQty,
        sales: round2(sales),
        cost: cost === null ? null : round2(cost),
        suppliers: [...bySupplier.entries()].map(([supplier, entry]) => ({ supplier, qty: entry.qty, cost: round2(entry.cost) })),
      });
    }
  }
  return lines;
}

export type ProfitGroupBy = 'part' | 'category' | 'brand' | 'customer' | 'supplier';

export type ProfitRow = {
  key: string;
  label: string;
  /** Part number, for the part view. */
  detail: string;
  qty: number;
  sales: number;
  /** Cost of the lines whose cost is known. */
  cost: number;
  /** Profit on the lines whose cost is known. */
  profit: number;
  /** Profit as a share of the sales it was earned on. Null with no costed sales. */
  marginPercent: number | null;
  /** Lines in this row with no recorded cost — their sales are in `sales`, not in `profit`. */
  uncostedLines: number;
  uncostedSales: number;
  bills: number;
};

/** One row per part / category / brand / customer / supplier. By supplier, each line is split
 *  across the batches it was drawn from, so a sale of stock bought from two suppliers counts
 *  toward both, in proportion. */
export function groupProfit(lines: ProfitLine[], by: ProfitGroupBy): ProfitRow[] {
  type Acc = ProfitRow & { billIds: Set<string>; costedSales: number };
  const rows = new Map<string, Acc>();
  const add = (key: string, label: string, detail: string, line: ProfitLine, share: number, costShare: number | null) => {
    const row = rows.get(key) ?? {
      key, label, detail, qty: 0, sales: 0, cost: 0, profit: 0, marginPercent: null, uncostedLines: 0, uncostedSales: 0, bills: 0,
      billIds: new Set<string>(), costedSales: 0,
    };
    const sales = line.sales * share;
    row.qty += line.qty * share;
    row.sales += sales;
    if (costShare === null) {
      row.uncostedLines += 1;
      row.uncostedSales += sales;
    } else {
      row.cost += costShare;
      row.costedSales += sales;
    }
    row.billIds.add(line.invoiceId);
    rows.set(key, row);
  };

  for (const line of lines) {
    if (by === 'supplier') {
      const drawn = line.suppliers.reduce((total, entry) => total + entry.qty, 0);
      if (line.cost === null || line.suppliers.length === 0 || drawn <= 0) {
        add(line.cost === null ? 'Not from stock' : NO_SUPPLIER, line.cost === null ? 'Not from stock (no recorded cost)' : NO_SUPPLIER, '', line, 1, line.cost);
        continue;
      }
      for (const entry of line.suppliers) add(entry.supplier, entry.supplier, '', line, entry.qty / drawn, entry.cost);
      continue;
    }
    const [key, label, detail] =
      by === 'part' ? [line.productId ?? `line:${line.name.toLowerCase()}`, line.name, line.partNumber]
      : by === 'category' ? [line.category, line.category, '']
      : by === 'brand' ? [line.brand, line.brand, '']
      : [line.customer, line.customer, ''];
    add(key, label, detail, line, 1, line.cost);
  }

  return [...rows.values()].map(({ billIds, costedSales, ...row }) => {
    const profit = costedSales - row.cost;
    return {
      ...row,
      qty: round2(row.qty),
      sales: round2(row.sales),
      cost: round2(row.cost),
      profit: round2(profit),
      marginPercent: costedSales > 0 ? round2((profit / costedSales) * 100) : null,
      uncostedSales: round2(row.uncostedSales),
      bills: billIds.size,
    };
  });
}

export type ProfitTotals = {
  sales: number;
  cost: number;
  profit: number;
  marginPercent: number | null;
  uncostedLines: number;
  uncostedSales: number;
  lines: number;
  bills: number;
};

export function profitTotals(lines: ProfitLine[]): ProfitTotals {
  let sales = 0;
  let cost = 0;
  let costedSales = 0;
  let uncostedLines = 0;
  let uncostedSales = 0;
  for (const line of lines) {
    sales += line.sales;
    if (line.cost === null) {
      uncostedLines += 1;
      uncostedSales += line.sales;
    } else {
      cost += line.cost;
      costedSales += line.sales;
    }
  }
  const profit = costedSales - cost;
  return {
    sales: round2(sales),
    cost: round2(cost),
    profit: round2(profit),
    marginPercent: costedSales > 0 ? round2((profit / costedSales) * 100) : null,
    uncostedLines,
    uncostedSales: round2(uncostedSales),
    lines: lines.length,
    bills: new Set(lines.map((line) => line.invoiceId)).size,
  };
}

export type ProfitSort = 'profit' | 'margin-low' | 'margin-high' | 'sales' | 'qty';

export function sortProfitRows(rows: ProfitRow[], sort: ProfitSort): ProfitRow[] {
  const byMargin = (direction: 1 | -1) => (a: ProfitRow, b: ProfitRow) => {
    // Rows with no margin go last either way: "unknown" is neither best nor worst.
    if (a.marginPercent === null) return b.marginPercent === null ? 0 : 1;
    if (b.marginPercent === null) return -1;
    return direction * (a.marginPercent - b.marginPercent);
  };
  const sorted = [...rows];
  if (sort === 'profit') sorted.sort((a, b) => b.profit - a.profit);
  else if (sort === 'sales') sorted.sort((a, b) => b.sales - a.sales);
  else if (sort === 'qty') sorted.sort((a, b) => b.qty - a.qty);
  else if (sort === 'margin-low') sorted.sort(byMargin(1));
  else sorted.sort(byMargin(-1));
  return sorted;
}
