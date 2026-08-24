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
  /** Only meaningful (and required) when isEdit is true — omit/pass null on create, since the
   *  database generates the real id itself (globally unique across every company, not something
   *  the client can safely guess from its own company-scoped view of existing invoices). */
  invoiceId: string | null;
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

async function sendJson<T>(method: 'POST' | 'DELETE', url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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

function postJson<T>(url: string, body: unknown): Promise<T> {
  return sendJson<T>('POST', url, body);
}

function deleteJson<T>(url: string, body: unknown): Promise<T> {
  return sendJson<T>('DELETE', url, body);
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

export type PaymentAllocationInput = { invoiceId: string; amount: number };

export type ReceiveCustomerPaymentInput = {
  companyId: string;
  customerId: string;
  date: string;
  amount: number;
  note: string;
  allocations: PaymentAllocationInput[];
};

/** Atomically records a customer payment and applies it across the invoices the owner chose —
 *  the payment, its allocations, each invoice's paid/status, and the customer balance all land
 *  together, so a customer who bought across several days on credit can pay the running total
 *  in one visit with a real receipt for it, instead of each invoice being hand-edited. */
export function receiveCustomerPayment(input: ReceiveCustomerPaymentInput) {
  return postJson<{ payment_id: string; applied_total: number }>('/api/sales/payments', input);
}

/** Atomically reverses a recorded payment — restores every invoice it touched to its prior paid
 *  amount and status and corrects the customer balance — for a payment entered wrong. */
export function deleteCustomerPayment(companyId: string, paymentId: string) {
  return deleteJson<{ ok: true }>('/api/sales/payments', { companyId, paymentId });
}
