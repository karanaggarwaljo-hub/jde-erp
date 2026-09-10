/** One definition of what stock on hand is worth, shared by every screen that reports it.
 *
 *  There were three. Inventory valued every unit of a part at its OLDEST still-open purchase
 *  batch; the Dashboard did the same; Reports and the export multiplied by the `cost_price` field.
 *  On the real shelf those gave ₹31,08,287 and ₹31,53,256 for the same stock, ₹44,969 apart.
 *
 *  Both were wrong in the same way, quite apart from disagreeing: a part bought ten at ₹100 and
 *  later ten at ₹200 has twenty units worth ₹3,000, but valuing all twenty at the oldest batch
 *  reports ₹2,000. The fix is to value each batch at what that batch cost, which is the whole
 *  point of keeping batches.
 *
 *  The rule, in order:
 *    - Walk the part's open batches oldest first, taking units until the part's stock count is
 *      covered. Each unit is worth what its own batch cost.
 *    - A batch with a zero or negative unit cost carries NO cost information — it is a price that
 *      was never captured, not stock that is free. Those units fall back to `cost_price`, which is
 *      how ₹27,970 of oil stopped being declared worthless when Inventory and the Dashboard were
 *      first reconciled (JCB-H49 and SER-E37, both entered 2026-07-30).
 *    - Stock beyond what any batch covers — a part that predates batch tracking, or was stocked
 *      without a purchase order — is also valued at `cost_price`.
 *    - Batch quantity BEYOND the part's stock count is ignored rather than counted. The two
 *      disagree on two parts today, and valuing units the shelf does not claim to have would
 *      overstate the total. `stockCountMismatches` below reports those separately, because a
 *      disagreement is a thing to fix, not a thing to quietly average away.
 */

export type StockLayerLike = {
  product_id: string;
  unit_cost: number;
  qty_remaining: number;
  created_at: string;
};

export type ValuedProduct = {
  id: string;
  current_stock: number;
  cost_price: number;
};

type OpenBatch = { unitCost: number; qty: number; createdAt: number };

/** Groups the open batches by part, oldest first, once — rather than scanning them per part. */
function openBatchesByProduct(layers: StockLayerLike[]): Map<string, OpenBatch[]> {
  const byProduct = new Map<string, OpenBatch[]>();
  for (const layer of layers) {
    const qty = Number(layer.qty_remaining);
    if (!(qty > 0)) continue;
    const batches = byProduct.get(layer.product_id) ?? [];
    batches.push({ unitCost: Number(layer.unit_cost), qty, createdAt: new Date(layer.created_at).getTime() });
    byProduct.set(layer.product_id, batches);
  }
  for (const batches of byProduct.values()) batches.sort((a, b) => a.createdAt - b.createdAt);
  return byProduct;
}

/** Builds a per-part valuation once, for screens that report many parts at a time. */
export function stockValueLookup(layers: StockLayerLike[]): (product: ValuedProduct) => number {
  const byProduct = openBatchesByProduct(layers);
  return (product) => {
    const fallback = Number(product.cost_price) || 0;
    let remaining = Number(product.current_stock) || 0;
    if (remaining <= 0) return 0;

    let value = 0;
    for (const batch of byProduct.get(product.id) ?? []) {
      if (remaining <= 0) break;
      const take = Math.min(batch.qty, remaining);
      value += take * (batch.unitCost > 0 ? batch.unitCost : fallback);
      remaining -= take;
    }
    // Whatever no batch accounts for.
    return value + remaining * fallback;
  };
}

/** What one part's stock on hand is worth. */
export function stockValueOf(product: ValuedProduct, layers: StockLayerLike[]): number {
  return stockValueLookup(layers)(product);
}

/** Total value of stock on hand across the parts given. */
export function totalStockValue(products: ValuedProduct[], layers: StockLayerLike[]): number {
  const valueOf = stockValueLookup(layers);
  return products.reduce((total, product) => total + valueOf(product), 0);
}

/** The per-unit cost to show NEXT TO a part: its oldest still-open priced batch, which is what
 *  the next sale of it will actually cost. Deliberately a different question from the one above —
 *  a single number cannot describe stock bought at two prices, which is why the total no longer
 *  uses this. Margin per part is worked out from it, because margin is about the next sale. */
export function fifoCostLookup(layers: StockLayerLike[]): (product: ValuedProduct) => number {
  const oldestOpen = new Map<string, { unitCost: number; createdAt: number }>();
  for (const layer of layers) {
    if (Number(layer.qty_remaining) <= 0) continue;
    // A zero or negative unit cost is a missing price, not a price of zero — skip it so the part
    // falls through to a later priced batch, or to cost_price, instead of being valued at nothing.
    if (!(Number(layer.unit_cost) > 0)) continue;
    const createdAt = new Date(layer.created_at).getTime();
    const current = oldestOpen.get(layer.product_id);
    if (!current || createdAt < current.createdAt) {
      oldestOpen.set(layer.product_id, { unitCost: Number(layer.unit_cost), createdAt });
    }
  }
  return (product) => oldestOpen.get(product.id)?.unitCost ?? Number(product.cost_price);
}

export type StockCountMismatch = {
  id: string;
  /** What the part's own stock count says is on the shelf. */
  currentStock: number;
  /** What its open purchase batches add up to. */
  batchQty: number;
};

/** Parts whose stock count and open batches disagree. Neither figure is assumed right: this is a
 *  list to go and count, not a correction to apply. Reported rather than smoothed over, because a
 *  valuation that hides its own uncertainty is worse than one that names it. */
export function stockCountMismatches(products: ValuedProduct[], layers: StockLayerLike[]): StockCountMismatch[] {
  const batchQtyByProduct = new Map<string, number>();
  for (const layer of layers) {
    const qty = Number(layer.qty_remaining);
    if (!(qty > 0)) continue;
    batchQtyByProduct.set(layer.product_id, (batchQtyByProduct.get(layer.product_id) ?? 0) + qty);
  }
  const mismatches: StockCountMismatch[] = [];
  for (const product of products) {
    const batchQty = batchQtyByProduct.get(product.id) ?? 0;
    const currentStock = Number(product.current_stock) || 0;
    // A part with no batches at all is not a disagreement — it simply predates batch tracking.
    if (batchQty === 0) continue;
    if (Math.abs(batchQty - currentStock) > 1e-9) mismatches.push({ id: product.id, currentStock, batchQty });
  }
  return mismatches;
}
