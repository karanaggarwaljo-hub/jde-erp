/**
 * The row shapes the sales screens share, and the GST state table that goes with them.
 *
 * These were previously redeclared in each of app/(dashboard)/sales/page.tsx, its invoice print
 * page and its quotation print page — three hand-kept copies, each carrying a comment saying which
 * file was the real source. They happened to be in step, but only because whoever added
 * `settlement_write_off` and `gst_mode` remembered all three. One forgotten copy is a print page
 * silently missing a field off a real invoice, which is the kind of bug nobody notices until a
 * customer queries a document.
 *
 * Shapes only — no logic, so nothing here can change behaviour.
 */

export type Product = {
  id: string;
  company_id: string;
  part_number: string;
  name: string;
  brand: string;
  hsn_code: string;
  category: string;
  sale_price: number;
  /** What the part cost to buy, used to warn before it is billed below cost. */
  cost_price: number;
  current_stock: number;
  image_url?: string | null;
};

export type Customer = {
  id: string;
  company_id: string;
  name: string;
  phone: string;
  email: string;
  gstin: string;
  address: string;
  type: string;
  balance: number;
  /** What this customer may owe at most; 0 or blank means no limit (lib/credit.ts). */
  credit_limit?: number | string | null;
};

// gst_percent / gst_amount are on the invoice table but were never filled in by the atomic save,
// so they are absent on every invoice written before this screen started recording them.
export type Invoice = {
  id: string;
  company_id: string;
  customer: string;
  date: string;
  items: number;
  total: number;
  paid: number;
  /** What the customer was let off when they settled for less than the invoice. Kept apart from
   *  `paid` so no document ever claims money arrived that didn't. */
  settlement_write_off: number;
  status: string;
  mode: string;
  discount_percent: number;
  discount_amount: number;
  gst_percent?: number | null;
  gst_amount?: number | null;
  gst_mode?: string | null;
  /** GST state code of the place of supply, chosen on the bill (lib/gst-supply.ts). */
  place_of_supply?: string | null;
  /** Dispatch details printed beside the invoice number (lib/invoice-dispatch.ts). */
  dispatched_through?: string | null;
  delivery_terms?: string | null;
  destination?: string | null;
  other_reference?: string | null;
  eway_bill_no?: string | null;
  /** Set when the invoice was cancelled (scripts/cancel-sales-invoice.sql). */
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  /** The invoice as issued, kept when it was cancelled. */
  cancelled_copy?: { invoice?: { total?: number | string | null } & Record<string, unknown>; items?: unknown[] } | null;
};

export type InvoiceItem = {
  id: string;
  invoice_id: string;
  product_id: string | null;
  part_number: string;
  name: string;
  qty: number;
  unit_price: number;
  line_total: number;
  discount_percent?: number;
  discount_amount?: number;
};

export type Quotation = {
  id: string;
  company_id: string;
  customer: string;
  date: string;
  validity: string;
  total: number;
  status: string;
};

export type Payment = {
  id: string;
  company_id: string;
  customer_id: string;
  customer: string;
  date: string;
  amount: number;
  note: string;
  created_at: string;
};

export type PaymentAllocation = {
  id: string;
  payment_id: string;
  company_id: string;
  invoice_id: string;
  amount: number;
  created_at: string;
};

/** The status the atomic save is given for a sale the owner wants to park and finish later. It
 *  reserves stock like any other invoice, but nothing is billed and nothing is owed yet.
 *  Shared with quotations, where a draft is a quote still being worked on: it is not ready to
 *  give to the customer and cannot be turned into an invoice until it is confirmed. */
export const DRAFT_STATUS = 'draft';

/** A cancelled invoice keeps its number but bills nothing (scripts/cancel-sales-invoice.sql). */
export const CANCELLED_STATUS = 'cancelled';

/** Whether an invoice is a sale that happened: not a parked draft, not a cancelled bill. Every
 *  count, average and total of sales goes through this, so neither is ever counted as a sale. */
export function isCountedSale(invoice: { status?: string | null }): boolean {
  return invoice.status !== DRAFT_STATUS && invoice.status !== CANCELLED_STATUS;
}

/** A quotation the owner has confirmed as finished. Only from here can it be turned into an
 *  invoice — which is the moment it costs stock and puts money on a customer's account. The
 *  database enforces this too; the button being hidden is not the rule. */
export const QUOTATION_FINAL_STATUS = 'final';

/** Billed to the counter, with no customer account behind it. A sale that isn't fully paid may
 *  not use this — see the credit check in the sales page. */
export const WALK_IN_CUSTOMER = 'Walk-in Customer';

/** GST state codes and names: lib/gst-supply.ts holds the one list. */
export { GST_STATES as GST_STATE_NAMES } from './gst-supply';

/** How a bill was settled at the moment it was written. */
export type PaymentStatus = 'paid' | 'partial' | 'unpaid';

/** One typed line on an invoice or a quotation. `discount` is a percentage off THIS line only,
 *  kept separate from the bill-wide discount. Optional because quotations reuse this shape and do
 *  not offer one — absent means none. */
export type InvoiceLine = { part: string; qty: number; price: number; discount?: number };

/** A part as offered in the "type a part" datalist: the label the owner picks, plus everything
 *  the form fills in behind it once picked. */
export type PartOption = {
  value: string;
  price: number;
  /** Catalogue cost, for the below-cost warning while a rate is being typed. */
  costPrice: number;
  category: string;
  partNumber: string;
  /** The catalogue name on its own, so search can rank a name match apart from a code match. */
  name: string;
  brand: string;
  stock: number;
  hsn: string;
};
