export type SalesInvoiceItemInput = {
  product_id: string | null;
  part_number: string;
  name: string;
  qty: number;
  unit_price: number;
  line_total: number;
};

export type SaveSalesInvoiceInput = {
  companyId: string;
  invoiceId: string;
  isEdit: boolean;
  customerLabel: string;
  oldCustomerId: string | null;
  newCustomerId: string | null;
  oldOutstanding: number;
  newOutstanding: number;
  date: string;
  items: SalesInvoiceItemInput[];
  total: number;
  paid: number;
  status: string;
  mode: string;
  discountPercent: number;
  discountAmount: number;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed: unknown;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Non-JSON body (e.g. an HTML error page) — fall through to the generic/status-based message.
    }
  }
  if (!res.ok) {
    const message = parsed && typeof parsed === 'object' && 'error' in parsed && typeof (parsed as { error: unknown }).error === 'string'
      ? (parsed as { error: string }).error
      : `${url} failed (${res.status})`;
    throw new Error(message);
  }
  return parsed as T;
}

/** Atomically creates or edits a sales invoice — header, line items, FIFO stock
 *  consumption/restoration, and customer balance — as one database transaction, instead of
 *  6-10 separate browser-initiated calls that could leave things half-done on failure. */
export function saveSalesInvoice(input: SaveSalesInvoiceInput) {
  return postJson<Record<string, unknown>>('/api/sales/save-invoice', input);
}

/** Atomically deletes a sales invoice — restores FIFO stock, reverses the customer balance, and
 *  removes the invoice and its items — as one database transaction. */
export function deleteSalesInvoice(invoiceId: string, customerId: string | null, outstanding: number) {
  return postJson<{ ok: true }>('/api/sales/delete-invoice', { invoiceId, customerId, outstanding });
}
