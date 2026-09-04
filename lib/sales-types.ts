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
  current_stock: number;
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

/** A quotation the owner has confirmed as finished. Only from here can it be turned into an
 *  invoice — which is the moment it costs stock and puts money on a customer's account. The
 *  database enforces this too; the button being hidden is not the rule. */
export const QUOTATION_FINAL_STATUS = 'final';

/** Billed to the counter, with no customer account behind it. A sale that isn't fully paid may
 *  not use this — see the credit check in the sales page. */
export const WALK_IN_CUSTOMER = 'Walk-in Customer';

/** First two digits of a GSTIN are the statutory state code; this maps them to the state name
 *  printed as "place of supply". Statutory data, not a business setting. */
export const GST_STATE_NAMES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman and Diu',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
  '99': 'Centre Jurisdiction',
};
