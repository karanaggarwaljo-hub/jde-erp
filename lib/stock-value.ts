/** One definition of what stock on hand is worth, shared by every screen that reports it.
 *
 *  This exists because there were two. Inventory valued stock at each part's oldest still-open
 *  purchase batch (what the next sale will actually cost), while the Dashboard multiplied by the
 *  `cost_price` field. Those agree only while the two are in step — and on real data they were
 *  not: two parts out of 242 had drifted far enough to put ₹27,970 between the same figure on two
 *  screens, which is exactly the kind of thing that makes an owner distrust every number in the app.
 *
 *  The batch cost leads, because `cost_price` is a single manually-entered field that does not
 *  change when stock is actually bought at a different price, while the FIFO batches are the
 *  recorded purchase history. `cost_price` is the fallback for a part with no usable batch — one
 *  that predates FIFO tracking, or was stocked without going through a purchase order.
 *
 *  A batch whose unit cost is zero or negative is treated as carrying NO cost information, not as
 *  a cost of zero. That distinction is the whole difference between the two figures that started
 *  this: both parts that disagreed had a batch recorded at ₹0 (JCB-H49 and SER-E37, both from
 *  2026-07-30), so valuing them "accurately" meant declaring ₹27,970 of oil on the shelf to be
 *  worth nothing. Stock is not free; a zero there means the price was never captured when it was
 *  entered. Genuinely free stock is rare enough that leaning the other way is the safer error.
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

/** Builds a per-product cost lookup once, rather than scanning the layers for every product. */
export function fifoCostLookup(layers: StockLayerLike[]): (product: ValuedProduct) => number {
  const oldestOpen = new Map<string, StockLayerLike>();
  for (const layer of layers) {
    if (Number(layer.qty_remaining) <= 0) continue;
    // A zero/negative unit cost is a missing price, not a price of zero — skip it so the part
    // falls through to a later priced batch, or to cost_price, instead of being valued at nothing.
    if (!(Number(layer.unit_cost) > 0)) continue;
    const current = oldestOpen.get(layer.product_id);
    if (!current || new Date(layer.created_at).getTime() < new Date(current.created_at).getTime()) {
      oldestOpen.set(layer.product_id, layer);
    }
  }
  return (product) => Number(oldestOpen.get(product.id)?.unit_cost ?? product.cost_price);
}

/** Total value of stock on hand: every part's quantity at its own oldest open batch cost. */
export function totalStockValue(products: ValuedProduct[], layers: StockLayerLike[]): number {
  const costFor = fifoCostLookup(layers);
  return products.reduce((total, product) => total + Number(product.current_stock || 0) * costFor(product), 0);
}
