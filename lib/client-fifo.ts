export type StockLayer = {
  id: string;
  company_id: string;
  product_id: string;
  unit_cost: number;
  qty_remaining: number;
  qty_original: number;
  source_po_id: string | null;
  created_at: string;
};

export type ConsumptionResult = { layer_id: string | null; qty_consumed: number; unit_cost: number };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${url} failed`);
  return res.json();
}

/** Opens a new FIFO cost batch for a product (a purchase, or a manual stock increase). */
export function addStockLayer(productId: string, qty: number, unitCost: number, sourcePoId: string | null = null, adjustStock = true) {
  return postJson<StockLayer>('/api/fifo/receive', { product_id: productId, qty, unit_cost: unitCost, source_po_id: sourcePoId, adjust_stock: adjustStock });
}

/** Draws `qty` from the oldest open batches first. Pass the invoice line's id so it can be
 *  reversed later via restoreStockForInvoiceItem; pass null for a one-off manual adjustment. */
export function consumeStockFifo(productId: string, qty: number, invoiceItemId: string | null) {
  return postJson<ConsumptionResult[]>('/api/fifo/consume', { product_id: productId, qty, invoice_item_id: invoiceItemId });
}

/** Reverses a prior consumeStockFifo call for one invoice line. */
export function restoreStockForInvoiceItem(invoiceItemId: string) {
  return postJson<{ restored_qty: number }>('/api/fifo/restore', { invoice_item_id: invoiceItemId }).then((r) => r.restored_qty);
}

/** Corrects the cost of the batch a product's displayed cost/margin currently reads from — for
 *  editing the Cost Price field with no stock quantity change alongside it. No-op if the product
 *  has no open batch (nothing to correct). */
export function correctOldestLayerCost(productId: string, newCost: number) {
  return postJson<{ layer: StockLayer | null }>('/api/fifo/correct-cost', { product_id: productId, new_cost: newCost }).then((r) => r.layer);
}
