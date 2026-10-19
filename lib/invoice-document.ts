/**
 * Everything printed on a sales invoice, as plain text in the order it appears — the content of
 * the saved PDF.
 *
 * Kept separate from drawing it so the content can be tested on its own, and so a saved PDF can
 * be compared with the invoice as it stands now: two invoices that would print the same text get
 * the same document, and nothing else does.
 */

import { paise } from './money';
import { invoiceFigures, type FigureInvoice, type FigureItem, type FigureReturn } from './invoice-figures';

export type DocCompany = {
  name: string;
  address?: string | null;
  gstin?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
};

export type DocCustomer = { address?: string | null; phone?: string | null; gstin?: string | null } | null;

export type DocInvoice = FigureInvoice & { id: string; date: string; customer: string };

export type DocItem = FigureItem & {
  part_number?: string | null;
  name: string;
  qty: number | string;
  unit_price: number | string;
};

export type InvoiceDocumentRow = {
  partNumber: string;
  description: string;
  qty: string;
  rate: string;
  discount: string;
  amount: string;
};

export type InvoiceDocumentTotal = { label: string; value: string; strong?: boolean };

export type InvoiceDocument = {
  companyName: string;
  companyLines: string[];
  number: string;
  date: string;
  status: string;
  billToName: string;
  billToLines: string[];
  showDiscountColumn: boolean;
  rows: InvoiceDocumentRow[];
  /** Said instead of rows for an invoice from before line items were recorded. */
  emptyNote: string | null;
  totals: InvoiceDocumentTotal[];
};

const text = (value: unknown) => String(value ?? '').trim();
const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
/** "Rs." rather than ₹: the PDF's built-in fonts have no rupee sign, and embedding a font that does
 *  would make every saved invoice several times larger. */
const rs = (value: number) => `Rs. ${paise(value)}`;
const joined = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join('  |  ');

export function buildInvoiceDocument(source: {
  invoice: DocInvoice;
  items: DocItem[];
  company: DocCompany;
  customer: DocCustomer;
  /** Credit notes against the invoice. */
  returns?: FigureReturn[];
}): InvoiceDocument {
  const { invoice, items, company, customer } = source;
  const f = invoiceFigures(invoice, items, source.returns ?? []);
  const paid = num(invoice.paid);
  const total = num(invoice.total);

  const companyLines = [
    text(company.address),
    joined(
      text(company.gstin) && `GSTIN: ${text(company.gstin)}`,
      text(company.contact_phone) && `Phone: ${text(company.contact_phone)}`,
      text(company.contact_email),
    ),
  ].filter(Boolean);

  const billToLines = [
    text(customer?.address),
    joined(
      text(customer?.phone) && `Phone: ${text(customer?.phone)}`,
      text(customer?.gstin) && `GSTIN: ${text(customer?.gstin)}`,
    ),
  ].filter(Boolean);

  const rows = items.map((item) => {
    const lineDiscount = num(item.discount_percent);
    return {
      partNumber: text(item.part_number) || '-',
      description: text(item.name),
      qty: String(num(item.qty)),
      rate: rs(num(item.unit_price)),
      discount: lineDiscount > 0 ? `${lineDiscount}% (-${rs(num(item.discount_amount))})` : '-',
      amount: rs(num(item.line_total)),
    };
  });

  const totals: InvoiceDocumentTotal[] = [];
  if (items.length > 0 && f.lineDiscountTotal > 0) totals.push({ label: 'Item discounts', value: `-${rs(f.lineDiscountTotal)}` });
  if (items.length > 0) totals.push({ label: f.lineDiscountTotal > 0 ? 'Subtotal after item discounts' : 'Subtotal', value: rs(f.subtotal) });
  if (f.returnedValue > 0) {
    totals.push({ label: `Less goods returned (${f.returnIds.join(', ')})`, value: `-${rs(f.returnedValue)}` });
    totals.push({ label: 'Subtotal after returns', value: rs(f.keptSubtotal) });
  }
  if (f.discountAmount > 0) totals.push({ label: `Discount (${num(invoice.discount_percent).toFixed(0)}%)`, value: `-${rs(f.discountAmount)}` });
  if (items.length > 0 && f.gstAmount > 0.005) {
    totals.push({ label: 'Taxable value', value: rs(f.netTaxableValue) });
    const percent = invoice.gst_percent == null ? '' : ` (${num(invoice.gst_percent)}%)`;
    totals.push({ label: `GST${percent}${f.gstInclusive ? ', included in the prices above' : ''}`, value: rs(f.gstAmount) });
  }
  totals.push({ label: 'Total', value: rs(total), strong: true });
  totals.push({ label: 'Paid', value: rs(paid) });
  // Its own line, never folded into Paid: this money was forgiven, not received.
  if (f.writtenOff > 0) totals.push({ label: 'Written off (settled short)', value: rs(f.writtenOff) });
  totals.push({ label: 'Balance due', value: rs(f.balanceDue), strong: true });

  const status = f.balanceDue <= 0
    ? (f.writtenOff > 0 ? 'SETTLED' : 'PAID')
    : paid > 0 ? 'PART PAID' : 'UNPAID';

  return {
    companyName: text(company.name) || 'Company',
    companyLines,
    number: invoice.id,
    date: text(invoice.date),
    status,
    billToName: text(invoice.customer) || 'Walk-in Customer',
    billToLines,
    showDiscountColumn: f.anyLineDiscount,
    rows,
    emptyNote: items.length === 0 ? 'Line items were not recorded for this older invoice; only the total is available.' : null,
    totals,
  };
}
