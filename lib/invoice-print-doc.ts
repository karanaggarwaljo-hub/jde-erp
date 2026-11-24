import { type Customer, type Invoice, type InvoiceItem } from '@/lib/sales-types';
import { type SalesReturnRow } from '@/lib/client-sales-returns';
import { asIssued, buildTallyInvoice, type TallyCompany, type TallyInvoice } from '@/lib/tally-invoice';

export type PartHsn = { id: string; hsn_code?: string | null };

/** The rows a printed bill is drawn from, as the pages that print bills already have them loaded. */
export type InvoicePrintRows = {
  items: InvoiceItem[];
  customers: Customer[];
  returns: SalesReturnRow[];
  parts: PartHsn[];
  company: TallyCompany | null;
};

/** One sales invoice as the GST Tax Invoice prints it, on screen. Shared by the single bill page and
 *  the month's office copies (Documents), so the two never draw a bill differently. A cancelled
 *  invoice is drawn as it was issued, stamped cancelled; each line's HSN comes from its part. */
export function invoicePrintDoc(invoice: Invoice, rows: InvoicePrintRows): TallyInvoice {
  const hsnOf = new Map(rows.parts.map((part) => [part.id, part.hsn_code ?? '']));
  const issued = asIssued(invoice as unknown as Record<string, unknown>, rows.items.filter((item) => item.invoice_id === invoice.id));
  const items = issued.items.map((item) => ({ ...item, hsn: item.product_id ? hsnOf.get(String(item.product_id)) ?? '' : '' }));
  const customer = rows.customers.find((row) => row.name === invoice.customer);
  const returns = rows.returns
    .filter((row) => row.invoice_id === invoice.id)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return buildTallyInvoice({
    invoice: issued.invoice as unknown as Invoice,
    items,
    company: rows.company ?? { name: 'Company' },
    customer: customer ? { address: customer.address, shipping_address: customer.shipping_address, phone: customer.phone, gstin: customer.gstin } : null,
    returns,
  });
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The month in a Documents print link: "2026-11" → "November 2026", "all" → "all months".
 *  Anything else is not a month (null). */
export function monthTitle(month: string): string | null {
  if (month === 'all') return 'all months';
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  return match ? `${MONTHS[Number(match[2]) - 1]} ${match[1]}` : null;
}
