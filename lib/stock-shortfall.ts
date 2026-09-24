/**
 * The parts a sale would take below zero, found before it is saved.
 *
 * The owner chose a warning over a block: a sale at the counter must never be stuck because the
 * purchase has not been typed in yet, but it must not pass unnoticed either — that is how
 * STEARING COUPLING 3DX reached −1 without anyone seeing it. The database still accepts the sale;
 * this is what names the part first.
 */

export type SaleLine = { productId: string | null; label: string; qty: number };
export type StockShortfall = { label: string; available: number; selling: number };

/** Quantities an existing invoice or parked draft already holds. Saving it again gives those back
 *  before drawing the new lines, so for that save they count as on the shelf. */
export function heldByProduct(items: ReadonlyArray<{ product_id: string | null; qty: number }>): Map<string, number> {
  const held = new Map<string, number>();
  for (const item of items) {
    if (!item.product_id) continue;
    held.set(item.product_id, (held.get(item.product_id) ?? 0) + (Number(item.qty) || 0));
  }
  return held;
}

export function stockShortfalls(
  lines: ReadonlyArray<SaleLine>,
  stockById: ReadonlyMap<string, number>,
  alreadyHeldById: ReadonlyMap<string, number> = new Map(),
): StockShortfall[] {
  // The same part on two lines draws from the same shelf, so it is judged on its total.
  const selling = new Map<string, { label: string; qty: number }>();
  for (const line of lines) {
    const qty = Number(line.qty) || 0;
    if (!line.productId || qty <= 0) continue;
    const entry = selling.get(line.productId);
    if (entry) entry.qty += qty;
    else selling.set(line.productId, { label: line.label, qty });
  }

  const shortfalls: StockShortfall[] = [];
  for (const [productId, { label, qty }] of selling) {
    const available = (Number(stockById.get(productId)) || 0) + (Number(alreadyHeldById.get(productId)) || 0);
    if (qty > available + 1e-9) shortfalls.push({ label, available, selling: qty });
  }
  return shortfalls;
}

function quantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/** The words for the confirmation. The caller adds its own question, since selling and converting
 *  a quotation ask different ones. */
export function shortfallNotice(shortfalls: ReadonlyArray<StockShortfall>): string {
  const one = shortfalls.length === 1;
  return [
    one ? 'This part does not have enough stock:' : 'These parts do not have enough stock:',
    ...shortfalls.map((s) => `• ${s.label} — ${quantity(s.available)} in stock, selling ${quantity(s.selling)}`),
    '',
    one
      ? 'Its stock will go below zero until you enter the purchase.'
      : 'Their stock will go below zero until you enter the purchases.',
  ].join('\n');
}
