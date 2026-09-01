import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';

export type QuotationItemInput = {
  product_id: string | null;
  part_number: string;
  name: string;
  qty: number;
  unit_price: number;
  /** Net of this line's own discount — the same meaning it has on an invoice line. */
  line_total: number;
  discount_percent?: number;
  discount_amount?: number;
};

export type QuotationInput = {
  companyId: string;
  quotationId: string | null;
  isEdit: boolean;
  customerId: string | null;
  customerLabel: string;
  date: string;
  validity: string;
  items: QuotationItemInput[];
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  gstPercent: number;
  gstAmount: number;
  /** 'exclusive' (tax added on top of the quoted rates) or 'inclusive' (tax already inside them).
   *  Optional so the server keeps its own default rather than this having to be sent everywhere. */
  gstMode?: 'exclusive' | 'inclusive';
  total: number;
};

export type QuotationDetail = {
  id: string;
  company_id: string;
  customer_id: string | null;
  customer: string;
  date: string;
  validity: string;
  subtotal: number;
  discount_percent: number;
  discount_amount: number;
  gst_percent: number;
  gst_amount: number;
  gst_mode?: string | null;
  total: number;
  status: string;
  items: QuotationItemInput[];
};

async function requestQuotation<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/sales/quotation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await parseJsonOrThrow(response, 'Quotation could not be saved.')) as T;
}

/** Saves a draft quotation only. It never consumes inventory or changes customer balances. */
export function saveQuotation(input: QuotationInput) {
  return requestQuotation<QuotationDetail>({ action: 'save', ...input });
}

/** Uses the database transaction to create the invoice from the quotation's persisted lines.
 * Stock is consumed only inside that conversion transaction, never while a quote is drafted. */
export function convertQuotation(quotationId: string, companyId: string) {
  return requestQuotation<{ invoiceId: string }>({ action: 'convert', quotationId, companyId });
}

export async function getQuotation(quotationId: string, companyId: string) {
  const response = await fetch(`/api/sales/quotation?id=${encodeURIComponent(quotationId)}&company_id=${encodeURIComponent(companyId)}`);
  return (await parseJsonOrThrow(response, 'Quotation could not be loaded.')) as QuotationDetail;
}
