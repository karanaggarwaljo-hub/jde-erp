/**
 * The dispatch details a GST tax invoice carries beside its number and date, as Tally prints them:
 * how the goods went, the terms of delivery, where to, any other reference (an order number), and
 * the e-way bill number. All optional, filled in on the bill form, each its own column on
 * jde_invoices (scripts/invoice-dispatch-details.sql), and printed by lib/tally-invoice.ts.
 */

export type DispatchKey = 'dispatched_through' | 'delivery_terms' | 'destination' | 'other_reference' | 'eway_bill_no';

export type InvoiceDispatch = Record<DispatchKey, string>;

/** In the order the invoice prints them, with the database's length limits. */
export const DISPATCH_FIELDS: Array<{ key: DispatchKey; label: string; printed: string; max: number; placeholder: string }> = [
  { key: 'dispatched_through', label: 'Dispatched through', printed: 'Disp Through', max: 120, placeholder: 'e.g. By road, PB65 AB 1234 / transporter' },
  { key: 'delivery_terms', label: 'Terms of delivery', printed: 'Terms of Delivery', max: 200, placeholder: 'e.g. Door delivery, freight paid' },
  { key: 'destination', label: 'Destination', printed: 'Destination', max: 120, placeholder: 'e.g. Shimla' },
  { key: 'other_reference', label: 'Other reference', printed: 'Other Reference', max: 120, placeholder: 'e.g. Order no. 45, dated 20-Oct' },
  { key: 'eway_bill_no', label: 'E-way bill no.', printed: 'E-Way Bill No.', max: 40, placeholder: 'e.g. 1234 5678 9012' },
];

export const EMPTY_DISPATCH: InvoiceDispatch = { dispatched_through: '', delivery_terms: '', destination: '', other_reference: '', eway_bill_no: '' };

/** What a saved invoice holds, as the form's values. */
export function dispatchOf(invoice: Partial<Record<DispatchKey, string | null | undefined>> | null | undefined): InvoiceDispatch {
  const out = { ...EMPTY_DISPATCH };
  for (const { key } of DISPATCH_FIELDS) out[key] = String(invoice?.[key] ?? '');
  return out;
}

/** What is stored: trimmed, cut to the column's limit, an empty box stored as nothing. Null when
 *  nothing was sent at all, so a caller that does not send them leaves them as they were. */
export function cleanDispatch(raw: unknown): Record<DispatchKey, string | null> | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const out = {} as Record<DispatchKey, string | null>;
  for (const { key, max } of DISPATCH_FIELDS) {
    const value = typeof source[key] === 'string' ? (source[key] as string).replace(/\s+/g, ' ').trim().slice(0, max) : '';
    out[key] = value || null;
  }
  return out;
}

export function hasDispatch(dispatch: InvoiceDispatch): boolean {
  return DISPATCH_FIELDS.some(({ key }) => dispatch[key].trim() !== '');
}
