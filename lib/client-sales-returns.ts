import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';

export type ReturnableInvoiceItem = {
  invoice_item_id: string;
  product_id: string | null;
  part_number: string;
  name: string;
  sold_qty: number;
  returned_qty: number;
  returnable_qty: number;
  unit_price: number;
  line_total: number;
};

export type SalesReturnInput = {
  companyId: string;
  invoiceId: string;
  customerId: string | null;
  reason: string;
  items: Array<{ invoice_item_id: string; qty: number }>;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  return await parseJsonOrThrow(response, 'Sales return request failed') as T;
}

/** Fetches the server-calculated remaining quantities. Never derive these from the invoice in the
 * browser: earlier partial returns must not be returned a second time. */
export function getReturnableInvoiceItems(companyId: string, invoiceId: string) {
  const params = new URLSearchParams({ returnCompanyId: companyId, returnInvoiceId: invoiceId });
  return request<ReturnableInvoiceItem[]>(`/api/sales?${params.toString()}`);
}

/** Creates a credit note and restores stock through one database transaction. */
export function createSalesReturn(input: SalesReturnInput) {
  return request<{ id: string; credit_total: number }>('/api/sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}
