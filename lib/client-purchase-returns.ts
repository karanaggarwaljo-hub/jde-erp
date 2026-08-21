export type PurchaseReturnLineInput = {
  /** The original purchase-order line; the server resolves the product and cost from this id. */
  poItemId: string;
  qty: number;
};

export type ReturnablePurchaseItem = {
  po_item_id: string;
  returned_qty: number;
  returnable_qty: number;
};

export type RecordPurchaseReturnInput = {
  companyId: string;
  poId: string;
  supplierId: string;
  lines: PurchaseReturnLineInput[];
  note?: string;
};

/** Server-calculated availability is required so a prior partial return can never be returned
 * again just because the browser still has the original purchase line cached. */
export async function getReturnablePurchaseItems(companyId: string, poId: string): Promise<ReturnablePurchaseItem[]> {
  const params = new URLSearchParams({ returnCompanyId: companyId, returnPoId: poId });
  const response = await fetch(`/api/purchases/receive?${params.toString()}`);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : `Could not load return availability (${response.status}).`;
    throw new Error(message);
  }
  return Array.isArray(payload) ? payload as ReturnablePurchaseItem[] : [];
}

/**
 * Records a supplier return through one database transaction. The browser deliberately sends
 * only line ids and quantities: the database procedure obtains product ids/costs from the
 * original purchase, prevents a second return of the same quantity, and makes the stock and
 * payable changes together.
 */
export async function recordPurchaseReturn(input: RecordPurchaseReturnInput): Promise<Record<string, unknown>> {
  const response = await fetch('/api/purchases/receive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, action: 'return' }),
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : `Could not record supplier return (${response.status}).`;
    throw new Error(message);
  }
  return (payload ?? {}) as Record<string, unknown>;
}
