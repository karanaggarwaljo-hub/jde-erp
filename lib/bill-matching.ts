/**
 * Checking a supplier's bill against what was ordered, received and paid.
 *
 * The Purchases screen has carried a "Supplier Invoices" tab since the app was built, saying only
 * that matching was not available yet. Everything needed to do it was already recorded — what each
 * purchase was billed at, whether it was received, what has been paid against it, and what has been
 * sent back — it was simply never brought together on one screen.
 *
 * Nothing here estimates or infers. Every figure is read off a recorded document, and where two
 * documents disagree that disagreement is reported rather than reconciled away, because a mismatch
 * between what a supplier billed and what arrived is exactly the thing worth looking at.
 */

export type BillablePurchase = {
  id: string;
  supplier: string;
  date: string;
  total: number;
  paid: number;
  status: string;
  /** The supplier's own number for the bill. Null or blank for anything recorded before it was
   *  captured, and for a bill that genuinely carries no number. */
  supplier_invoice_no?: string | null;
  supplier_invoice_date?: string | null;
};

export type PurchaseLine = { po_id: string; qty: number; line_total: number };
export type ReturnToSupplier = { po_id: string; credit_total: number };

/** Something about this purchase that does not add up, and is worth a person looking at. */
export type BillFlag =
  | 'no_bill_number'
  | 'billed_not_received'
  | 'overpaid'
  | 'no_lines'
  | 'lines_disagree_with_total';

export const FLAG_TEXT: Record<BillFlag, string> = {
  no_bill_number: 'No bill number recorded, so a second copy of this bill would not be recognised',
  billed_not_received: 'Billed but never marked received, so nothing went into stock',
  overpaid: 'Paid more than the bill, after credits for anything returned',
  no_lines: 'No item lines recorded against this purchase',
  lines_disagree_with_total: 'The item lines do not add up to the bill total',
};

export type MatchedBill = {
  purchase: BillablePurchase;
  billNumber: string | null;
  /** What the item lines add up to, which is not automatically the bill total. */
  linesTotal: number;
  lineCount: number;
  received: boolean;
  /** Credited back by anything sent to the supplier against this purchase. */
  credited: number;
  /** Bill, less credits, less what has been paid. Never below zero. */
  outstanding: number;
  flags: BillFlag[];
};

const money = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** A penny either way is rounding, not a discrepancy worth showing somebody. */
const TOLERANCE = 0.01;

export function matchBills(
  purchases: BillablePurchase[],
  lines: PurchaseLine[],
  returns: ReturnToSupplier[]
): MatchedBill[] {
  const linesByPurchase = new Map<string, { total: number; count: number }>();
  for (const line of lines) {
    const entry = linesByPurchase.get(line.po_id) ?? { total: 0, count: 0 };
    entry.total += money(line.line_total);
    entry.count += 1;
    linesByPurchase.set(line.po_id, entry);
  }

  const creditByPurchase = new Map<string, number>();
  for (const credit of returns) {
    creditByPurchase.set(credit.po_id, (creditByPurchase.get(credit.po_id) ?? 0) + money(credit.credit_total));
  }

  return purchases.map((purchase) => {
    const billed = money(purchase.total);
    const paid = money(purchase.paid);
    const credited = round2(creditByPurchase.get(purchase.id) ?? 0);
    const lineInfo = linesByPurchase.get(purchase.id) ?? { total: 0, count: 0 };
    const linesTotal = round2(lineInfo.total);
    const received = purchase.status === 'received';
    const billNumber = purchase.supplier_invoice_no?.trim() ? purchase.supplier_invoice_no.trim() : null;
    const owed = round2(billed - credited - paid);

    const flags: BillFlag[] = [];
    if (!billNumber) flags.push('no_bill_number');
    if (!received && billed > 0) flags.push('billed_not_received');
    if (owed < -TOLERANCE) flags.push('overpaid');
    if (lineInfo.count === 0) flags.push('no_lines');
    // Only worth saying when there ARE lines: "no lines" already covers the other case, and
    // reporting both about the same purchase reads as two problems instead of one.
    else if (Math.abs(linesTotal - billed) > TOLERANCE) flags.push('lines_disagree_with_total');

    return {
      purchase,
      billNumber,
      linesTotal,
      lineCount: lineInfo.count,
      received,
      credited,
      outstanding: Math.max(owed, 0),
      flags,
    };
  });
}

export type BillTotals = {
  billed: number;
  paid: number;
  credited: number;
  outstanding: number;
  count: number;
  /** How many purchases have at least one thing worth looking at. */
  flagged: number;
  withoutBillNumber: number;
};

export function billTotals(matched: MatchedBill[]): BillTotals {
  return matched.reduce<BillTotals>(
    (totals, bill) => ({
      billed: round2(totals.billed + money(bill.purchase.total)),
      paid: round2(totals.paid + money(bill.purchase.paid)),
      credited: round2(totals.credited + bill.credited),
      outstanding: round2(totals.outstanding + bill.outstanding),
      count: totals.count + 1,
      flagged: totals.flagged + (bill.flags.length > 0 ? 1 : 0),
      withoutBillNumber: totals.withoutBillNumber + (bill.billNumber === null ? 1 : 0),
    }),
    { billed: 0, paid: 0, credited: 0, outstanding: 0, count: 0, flagged: 0, withoutBillNumber: 0 }
  );
}

/**
 * Bills that share a number with another bill from the same supplier.
 *
 * The database refuses this outright for anything recorded from now on. This finds any that were
 * already on file before that rule existed, which is the only way they can still be here.
 */
export function duplicateBillNumbers(matched: MatchedBill[]): MatchedBill[][] {
  const groups = new Map<string, MatchedBill[]>();
  for (const bill of matched) {
    if (!bill.billNumber) continue;
    const key = `${bill.purchase.supplier.trim().toLowerCase()}::${bill.billNumber.toUpperCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), bill]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}
