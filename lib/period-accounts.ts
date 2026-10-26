/**
 * What a period actually earned, and what tax it actually carries.
 *
 * Both figures were being invented on the Reports screen, in the two ways that matter most:
 *
 *   Profit. "Gross margin" was sales minus everything bought in the same window — which is a
 *   cash-out figure, not a cost of sales. Buying stock made the shop look less profitable the
 *   moment it was bought; selling stock bought last month looked like pure profit. The real cost
 *   of what left the shelf is already recorded, batch by batch, against every invoice line
 *   (jde_stock_consumptions). This uses that.
 *
 *   Tax. The GST panel divided every total by 1.18 and reported the difference as tax collected,
 *   whatever the invoices actually said. On the real data not one invoice or purchase order
 *   carries any GST at all, so that panel was reporting roughly ₹11,700 of output tax that was
 *   never charged to anybody. Tax here comes only from what the documents themselves record, and
 *   when they record none, the honest answer is that there is nothing to report.
 *
 * Neither function guesses. Where the underlying records cannot answer, they say which records
 * and how many, so the screen can show that instead of a confident wrong number.
 */

import { round2 } from '@/lib/money';
import { supplyTax } from '@/lib/gst-supply';

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** `gst_amount` is the tax the bill records: part of its total, but the government's money. */
export type PeriodInvoice = { id: string; total: number | string; gst_amount?: number | string | null };
export type PeriodInvoiceItem = { id: string; invoice_id: string };
export type PeriodConsumption = { invoice_item_id: string; qty: number | string | null; unit_cost: number | string | null };

export type CostOfSales = {
  /** Cost of the goods that left the shelf, from the batches they were actually drawn from. */
  cost: number;
  /** Lines whose cost nobody recorded — usually a free-text line with no stocked part behind it. */
  linesWithoutCost: number;
  /** How many invoices contain at least one such line. */
  invoicesAffected: number;
  /** True only when every line of every invoice in the period has a recorded cost. A caller must
   *  not present a margin as fact when this is false. */
  complete: boolean;
};

/** Cost of goods sold across a set of invoices, from the FIFO batches their lines drew on. */
export function costOfSales(
  invoices: PeriodInvoice[],
  items: PeriodInvoiceItem[],
  consumptions: PeriodConsumption[]
): CostOfSales {
  const invoiceIds = new Set(invoices.map((invoice) => invoice.id));

  const costByItem = new Map<string, number>();
  for (const draw of consumptions) {
    costByItem.set(draw.invoice_item_id, (costByItem.get(draw.invoice_item_id) ?? 0) + num(draw.qty) * num(draw.unit_cost));
  }

  let cost = 0;
  let linesWithoutCost = 0;
  const affected = new Set<string>();
  for (const item of items) {
    if (!invoiceIds.has(item.invoice_id)) continue;
    const lineCost = costByItem.get(item.id);
    // Never silently valued at zero: that would report the whole line as profit.
    if (lineCost === undefined) {
      linesWithoutCost += 1;
      affected.add(item.invoice_id);
    } else {
      cost += lineCost;
    }
  }

  return {
    cost: round2(cost),
    linesWithoutCost,
    invoicesAffected: affected.size,
    complete: linesWithoutCost === 0,
  };
}

export type GrossProfit = {
  /** What the bills came to, GST included. */
  salesIncludingGst: number;
  /** The GST on them, collected for the government. */
  gstCollected: number;
  /** Sales before GST: what profit is worked from. */
  netSales: number;
  costOfSales: number;
  grossProfit: number;
  /** Gross profit as a share of sales. Null when there were no sales. */
  marginPercent: number | null;
};

/** Sales less what those sales cost. Returns null when the cost is not fully known, so a caller
 *  has nothing to display by accident — the same rule the settle-and-close dialog already uses.
 *
 *  Sales are taken before GST. A bill's total includes its GST, which is collected for the
 *  government, while the cost of goods is what the stock cost before GST; counting the tax as
 *  sales made gross profit more than double what it was (audit, October 2026). Profit by Part
 *  (lib/part-profit.ts) already worked from the taxable value, so the two now agree. */
export function grossProfit(invoices: PeriodInvoice[], cost: CostOfSales): GrossProfit | null {
  if (!cost.complete) return null;
  const salesIncludingGst = round2(invoices.reduce((total, invoice) => total + num(invoice.total), 0));
  const gstCollected = round2(invoices.reduce((total, invoice) => total + num(invoice.gst_amount), 0));
  const netSales = round2(salesIncludingGst - gstCollected);
  const profit = round2(netSales - cost.cost);
  return {
    salesIncludingGst,
    gstCollected,
    netSales,
    costOfSales: cost.cost,
    grossProfit: profit,
    marginPercent: netSales > 0 ? round2((profit / netSales) * 100) : null,
  };
}

export type TaxedDocument = { gst_amount?: number | string | null };

export type GstPosition = {
  /** Tax charged on sales, added up from what the invoices themselves record. */
  outputTax: number;
  /** Tax paid on purchases, likewise. */
  inputTax: number;
  /** Output less input. Never below zero — a credit position is reported as nothing payable. */
  netPayable: number;
  invoiceCount: number;
  invoicesWithTax: number;
  purchaseCount: number;
  purchasesWithTax: number;
  /** False when not one document in the period records any tax. The screen must then say that,
   *  rather than deriving a figure from the totals as though a rate had been charged. */
  anyTaxRecorded: boolean;
};

/** The GST position for a period, taken only from what the documents record. */
export function gstPosition(invoices: TaxedDocument[], purchases: TaxedDocument[]): GstPosition {
  const taxOf = (documents: TaxedDocument[]) => documents.reduce((total, doc) => total + num(doc.gst_amount), 0);
  const countWithTax = (documents: TaxedDocument[]) => documents.filter((doc) => num(doc.gst_amount) > 0).length;

  const outputTax = round2(taxOf(invoices));
  const inputTax = round2(taxOf(purchases));
  const invoicesWithTax = countWithTax(invoices);
  const purchasesWithTax = countWithTax(purchases);

  return {
    outputTax,
    inputTax,
    netPayable: round2(Math.max(0, outputTax - inputTax)),
    invoiceCount: invoices.length,
    invoicesWithTax,
    purchaseCount: purchases.length,
    purchasesWithTax,
    anyTaxRecorded: invoicesWithTax > 0 || purchasesWithTax > 0,
  };
}

/** Output tax by the kind it is, bill by bill: IGST on a sale to another state, else CGST plus SGST
 *  (or UTGST in a Union Territory such as Chandigarh), from each bill's own place of supply
 *  (lib/gst-supply.ts) — the same rule the invoice prints by. The summary used to halve the whole
 *  figure into CGST and SGST, which put every inter-state sale under the wrong tax and called
 *  Chandigarh's UTGST "SGST" (audit, October 2026). */
export type OutputTaxSplit = { igst: number; cgst: number; stateTax: number; stateTaxName: 'SGST' | 'UTGST' };

export function outputTaxSplit(
  invoices: Array<TaxedDocument & { customer?: string | null; place_of_supply?: string | null }>,
  seller: { gstin?: string | null; state_code?: string | null },
  buyerGstin: (customer: string) => string | null | undefined,
): OutputTaxSplit {
  let igst = 0;
  let cgst = 0;
  let stateTax = 0;
  for (const invoice of invoices) {
    const tax = num(invoice.gst_amount);
    if (tax <= 0) continue;
    const supply = supplyTax(seller.gstin, buyerGstin(String(invoice.customer ?? '')), invoice.place_of_supply, seller.state_code);
    if (supply.kind === 'inter') igst += tax;
    else {
      const half = round2(tax / 2);
      cgst += half;
      stateTax += tax - half;
    }
  }
  return {
    igst: round2(igst),
    cgst: round2(cgst),
    stateTax: round2(stateTax),
    stateTaxName: supplyTax(seller.gstin, null, null, seller.state_code).localTax,
  };
}
