export type PurchaseItemInput = {
  product_id: string | null;
  part_number: string;
  name: string;
  qty: number;
  unit_cost: number;
  line_total: number;
};

export type SavePurchaseInput = {
  companyId: string;
  supplierId: string | null;
  supplierName: string;
  date: string;
  receivedAt: string;
  items: PurchaseItemInput[];
  total: number;
  paid: number;
  status: string;
  /** SHA-256 hash of the source invoice file — set when this purchase came from a scanned/
   *  imported file, so the server can reject the exact same file being recorded twice. */
  sourceFileHash?: string | null;
};

export type ReceivePurchaseStockInput = {
  companyId: string;
  poId: string;
  supplierName: string;
  receivedAt: string;
  items: Array<{ product_id: string | null; qty: number; unit_cost: number }>;
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

/** Atomically records a new purchase — PO header, line items, GRN, FIFO stock layers, and
 *  supplier balance — as one database transaction, instead of 5-9+ separate browser-initiated
 *  calls that could leave things half-done on failure. */
export function savePurchase(input: SavePurchaseInput) {
  return postJson<Record<string, unknown>>('/api/purchases/save', input);
}

/** Records a payment against one purchase order. The order's paid amount and the supplier's
 *  outstanding balance are updated together in a single database transaction; how much is still
 *  owing is decided there, not here. */
export function recordPurchasePayment(input: { companyId: string; poId: string; amount: number }) {
  return postJson<Record<string, unknown>>('/api/purchases/pay', input);
}

/** Atomically marks a pre-existing pending purchase order received — GRN, FIFO stock layers,
 *  and status — as one database transaction. */
export function receivePurchaseStock(input: ReceivePurchaseStockInput) {
  return postJson<Record<string, unknown>>('/api/purchases/receive', input);
}
