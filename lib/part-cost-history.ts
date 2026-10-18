/**
 * Everything a part has cost the shop: every batch bought, from whom, when and at what price; the
 * stock still on the shelf and what it is worth at what was actually paid; whether the price is
 * rising; and who sold it cheapest last time. Shown in the part's window.
 *
 * Built from the FIFO batches (jde_stock_layers): each purchase of a part becomes one batch with
 * its own cost, so the batches are the purchase history — including stock entered as opening stock
 * or by an adjustment, which has a batch but no purchase behind it.
 *
 * Pure: the server gathers the rows (lib/db getPartCostSource), this does the arithmetic.
 */

import { groupProfit, profitTotals, type ProfitLine, type ProfitTotals } from './part-profit';

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const round2 = (value: number) => Math.round(value * 100) / 100;

export type CostBatch = {
  id: string;
  unit_cost: number | string;
  qty_original: number | string;
  qty_remaining: number | string;
  created_at: string;
  source_po_id: string | null;
};
export type CostPurchase = { id: string; supplier: string; date: string; supplier_invoice_no?: string | null };

export const OPENING_STOCK = 'Opening stock / adjustment';
/** A newest price this much above the one before is worth pointing out. */
export const PRICE_RISE_ALERT_PERCENT = 5;

export type CostHistoryEntry = {
  batchId: string;
  date: string;
  supplier: string;
  purchaseId: string | null;
  supplierBillNo: string | null;
  qtyBought: number;
  qtyLeft: number;
  unitCost: number;
};

export type PartCostHistory = {
  entries: CostHistoryEntry[];
  lastCost: number | null;
  previousCost: number | null;
  /** Newest price against the one before it, in percent. Null without two prices. */
  changePercent: number | null;
  rising: boolean;
  /** Average paid per unit across every batch, weighted by quantity bought. */
  averageCost: number | null;
  onHand: number;
  /** What the stock on the shelf cost, batch by batch. */
  stockValue: number;
  /** Each supplier's most recent price, cheapest first. Only meaningful with two or more. */
  suppliers: Array<{ supplier: string; lastCost: number; lastDate: string; times: number }>;
};

export function partCostHistory(batches: CostBatch[], purchases: CostPurchase[]): PartCostHistory {
  const purchasesById = new Map(purchases.map((purchase) => [purchase.id, purchase]));
  const entries: CostHistoryEntry[] = batches.map((batch) => {
    const purchase = batch.source_po_id ? purchasesById.get(batch.source_po_id) : undefined;
    return {
      batchId: batch.id,
      // The purchase's own date where there is one: the batch is stamped when stock was received,
      // which can be days after the bill.
      date: (purchase?.date || String(batch.created_at || '')).slice(0, 10),
      supplier: purchase?.supplier?.trim() || OPENING_STOCK,
      purchaseId: batch.source_po_id,
      supplierBillNo: purchase?.supplier_invoice_no?.trim() || null,
      qtyBought: num(batch.qty_original),
      qtyLeft: num(batch.qty_remaining),
      unitCost: round2(num(batch.unit_cost)),
    };
  });
  // Newest first; batches of one day keep the order they were received in.
  const created = new Map(batches.map((batch) => [batch.id, String(batch.created_at || '')]));
  entries.sort((a, b) => b.date.localeCompare(a.date) || (created.get(b.batchId) ?? '').localeCompare(created.get(a.batchId) ?? ''));

  const priced = entries.filter((entry) => entry.unitCost > 0);
  const lastCost = priced[0]?.unitCost ?? null;
  const previousCost = priced[1]?.unitCost ?? null;
  const changePercent = lastCost !== null && previousCost !== null && previousCost > 0
    ? round2(((lastCost - previousCost) / previousCost) * 100)
    : null;

  const boughtQty = priced.reduce((total, entry) => total + entry.qtyBought, 0);
  const boughtValue = priced.reduce((total, entry) => total + entry.qtyBought * entry.unitCost, 0);

  const suppliers = new Map<string, { supplier: string; lastCost: number; lastDate: string; times: number }>();
  for (const entry of priced) {
    if (entry.supplier === OPENING_STOCK) continue;
    const known = suppliers.get(entry.supplier);
    // entries are newest first, so the first seen is the supplier's latest price.
    if (known) known.times += 1;
    else suppliers.set(entry.supplier, { supplier: entry.supplier, lastCost: entry.unitCost, lastDate: entry.date, times: 1 });
  }

  return {
    entries,
    lastCost,
    previousCost,
    changePercent,
    rising: changePercent !== null && changePercent >= PRICE_RISE_ALERT_PERCENT,
    averageCost: boughtQty > 0 ? round2(boughtValue / boughtQty) : null,
    onHand: round2(entries.reduce((total, entry) => total + entry.qtyLeft, 0)),
    stockValue: round2(entries.reduce((total, entry) => total + entry.qtyLeft * entry.unitCost, 0)),
    suppliers: [...suppliers.values()].sort((a, b) => a.lastCost - b.lastCost),
  };
}

export type PartSales = {
  allTime: ProfitTotals & { qty: number };
  /** The last 90 days up to and including `today`. */
  recent: ProfitTotals & { qty: number };
  topCustomers: Array<{ customer: string; qty: number; sales: number }>;
};

export function partSales(lines: ProfitLine[], today: string): PartSales {
  const since = new Date(`${today}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 89);
  const sinceIso = since.toISOString().slice(0, 10);
  const recentLines = lines.filter((line) => line.date >= sinceIso && line.date <= today);
  const withQty = (subset: ProfitLine[]) => ({ ...profitTotals(subset), qty: round2(subset.reduce((total, line) => total + line.qty, 0)) });
  const topCustomers = groupProfit(lines, 'customer')
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 3)
    .map((row) => ({ customer: row.label, qty: row.qty, sales: row.sales }));
  return { allTime: withQty(lines), recent: withQty(recentLines), topCustomers };
}
