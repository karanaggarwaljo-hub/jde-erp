/**
 * What a sales invoice actually earned, measured against the real cost of the goods that left
 * the shelf for it.
 *
 * This exists for the settle-and-close dialog. When a customer pays less than the invoice and
 * both sides agree that closes it, the number the owner wants on screen is not the shortfall —
 * it is what the sale still made. Answering that honestly needs the true cost of those goods,
 * which the FIFO layers already record line by line (jde_stock_consumptions), rather than an
 * average or the product's current cost price.
 *
 * The one rule that matters here: when a line has no recorded cost behind it, the cost of the
 * invoice is UNKNOWN — not zero. Treating it as zero reports the entire sale value as profit,
 * which is a confident wrong number of exactly the kind someone acts on. `cost_known` is how a
 * caller tells the two apart, and a caller that cannot prove the cost must show no profit figure
 * at all rather than a flattering guess.
 */

import { round2 } from '@/lib/money';

export type ProfitInvoiceItem = { id: string };

export type ProfitConsumption = {
  invoice_item_id: string;
  qty: number | string | null;
  unit_cost: number | string | null;
};

export type InvoiceCost = {
  /** Cost of goods for the whole invoice. Meaningless unless `cost_known` is true. */
  cost: number;
  /** True only when every line on the invoice has FIFO cost recorded against it. */
  cost_known: boolean;
  line_count: number;
  lines_without_cost: number;
};

function num(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Adds up what the goods on one invoice cost, from the FIFO draws recorded against its lines. */
export function invoiceCostOfGoods(items: ProfitInvoiceItem[], consumptions: ProfitConsumption[]): InvoiceCost {
  const costByItem = new Map<string, number>();
  for (const draw of consumptions) {
    const previous = costByItem.get(draw.invoice_item_id) ?? 0;
    costByItem.set(draw.invoice_item_id, previous + num(draw.qty) * num(draw.unit_cost));
  }

  let cost = 0;
  let linesWithoutCost = 0;
  for (const item of items) {
    const lineCost = costByItem.get(item.id);
    // A line with no draw at all is a line whose cost nobody recorded — most often a free-text
    // line sold without a stocked product behind it. Counted, never silently valued at zero.
    if (lineCost === undefined) linesWithoutCost += 1;
    else cost += lineCost;
  }

  return {
    cost: round2(cost),
    cost_known: items.length > 0 && linesWithoutCost === 0,
    line_count: items.length,
    lines_without_cost: linesWithoutCost,
  };
}

export type RealisedProfit = {
  /** Money that actually arrived against this invoice — never includes anything settled off. */
  received: number;
  cost: number;
  /** Received minus cost. Negative when the goods cost more than was collected, which is a real
   *  result and is reported as one, not hidden. */
  profit: number;
  /** Profit as a share of what was received. Null when nothing was received, since a percentage
   *  of zero says nothing. */
  margin_percent: number | null;
};

/**
 * What the owner is left with once a sale is closed for whatever was actually collected.
 *
 * Measuring against cash received rather than the invoice total is the whole point: any amount
 * settled off is already absent from `received`, so the shortfall is accounted for without
 * having to be presented as a loss in its own right.
 *
 * Returns null when the cost is not known, so the caller has nothing to display by accident.
 */
export function realisedProfit(received: number, cost: InvoiceCost): RealisedProfit | null {
  if (!cost.cost_known) return null;
  const receivedAmount = round2(received);
  const profit = round2(receivedAmount - cost.cost);
  return {
    received: receivedAmount,
    cost: cost.cost,
    profit,
    margin_percent: receivedAmount > 0 ? round2((profit / receivedAmount) * 100) : null,
  };
}
