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
  /** `condition` says whether the goods can be sold again. Damaged goods still credit the
   *  customer in full; they simply do not go back on the sellable shelf. Omitted means resellable,
   *  which is what the database assumes too. */
  items: Array<{ invoice_item_id: string; qty: number; condition?: 'resellable' | 'damaged' }>;
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

export type SalesReturnRow = {
  id: string;
  invoice_id: string;
  customer_id: string | null;
  reason: string;
  credit_total: number;
  refund_or_credit_amount: number;
  created_at: string;
};

/** Undoes a credit note: the goods come back off the shelf, and the invoice and the customer's
 *  balance are put back — but only when that credit note's lines still point at the invoice they
 *  came from. Where the invoice has been rebuilt by an edit since, its total no longer has this
 *  credit taken off it, so only the stock is reversed. `invoice_restored` says which happened. */
export function deleteSalesReturn(companyId: string, returnId: string) {
  return request<{ id: string; credit_total: number; invoice_restored: boolean }>('/api/sales', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId, returnId }),
  });
}
