/**
 * Everything one part has done, assembled from the rows behind it.
 *
 * Pure on purpose: the route fetches, this arranges, so the arithmetic that the screen states as
 * fact — what a part has sold for, what it has cost, what is left on the shelf — is tested.
 */

export type Row = Record<string, unknown>;

export type PartOverviewRows = {
  layers: Row[];
  invoiceItems: Row[];
  invoices: Row[];
  poItems: Row[];
  purchaseOrders: Row[];
  returnItems: Row[];
  returns: Row[];
};

export type PartBatch = {
  id: string;
  boughtOn: string;
  unitCost: number;
  left: number;
  bought: number;
  /** The purchase this batch came in on, or null for stock entered as opening stock. */
  source: string | null;
};

export type PartMovement = {
  id: string;
  documentId: string;
  date: string;
  who: string;
  qty: number;
  rate: number;
  total: number;
};

export type PartOverview = {
  batches: PartBatch[];
  sales: PartMovement[];
  purchases: PartMovement[];
  returns: PartMovement[];
  totals: {
    soldQty: number;
    soldValue: number;
    boughtQty: number;
    boughtValue: number;
    returnedQty: number;
    /** What the stock on the shelf is worth, batch by batch, not stock × one price. */
    onHandValue: number;
    /** What the next sale will cost, from the oldest batch still open. */
    nextCost: number | null;
  };
};

const text = (value: unknown) => String(value ?? '').trim();
const amount = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const byDateDesc = (a: { date: string }, b: { date: string }) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

function indexById(rows: Row[]): Map<string, Row> {
  return new Map(rows.map((row) => [text(row.id), row]));
}

export function buildPartOverview(rows: PartOverviewRows, limit = 10): PartOverview {
  // Ordered by the moment each batch was entered, not just its day: two batches entered minutes
  // apart on the same day (an opening count and its correction, say) must keep their real order.
  const batches: PartBatch[] = [...rows.layers]
    .sort((a, b) => (text(a.created_at) < text(b.created_at) ? -1 : text(a.created_at) > text(b.created_at) ? 1 : 0))
    .map((layer) => ({
      id: text(layer.id),
      boughtOn: text(layer.created_at).slice(0, 10),
      unitCost: amount(layer.unit_cost),
      left: amount(layer.qty_remaining),
      bought: amount(layer.qty_original),
      source: text(layer.source_po_id) || null,
    }));

  const invoices = indexById(rows.invoices);
  const sales: PartMovement[] = rows.invoiceItems.map((item) => {
    const invoice = invoices.get(text(item.invoice_id));
    const qty = amount(item.qty);
    const rate = amount(item.unit_price);
    return {
      id: text(item.id),
      documentId: text(item.invoice_id),
      date: text(invoice?.date).slice(0, 10),
      who: text(invoice?.customer) || 'Walk-in Customer',
      qty,
      rate,
      total: amount(item.line_total) || qty * rate,
    };
  }).sort(byDateDesc);

  const orders = indexById(rows.purchaseOrders);
  const purchases: PartMovement[] = rows.poItems.map((item) => {
    const order = orders.get(text(item.po_id));
    const qty = amount(item.qty);
    const rate = amount(item.unit_cost);
    return {
      id: text(item.id),
      documentId: text(item.po_id),
      date: text(order?.date).slice(0, 10),
      who: text(order?.supplier) || 'Supplier not named',
      qty,
      rate,
      total: amount(item.line_total) || qty * rate,
    };
  }).sort(byDateDesc);

  const creditNotes = indexById(rows.returns);
  const returns: PartMovement[] = rows.returnItems.map((item) => {
    const credit = creditNotes.get(text(item.sales_return_id));
    const qty = amount(item.qty);
    const rate = amount(item.unit_price);
    return {
      id: text(item.id),
      documentId: text(item.sales_return_id),
      date: text(credit?.created_at).slice(0, 10),
      who: text(item.condition) === 'damaged' ? 'Came back damaged' : 'Came back to stock',
      qty,
      rate,
      total: amount(item.line_total) || qty * rate,
    };
  }).sort(byDateDesc);

  const open = batches.filter((batch) => batch.left > 0);
  return {
    batches: batches.slice(-limit).reverse(),
    sales: sales.slice(0, limit),
    purchases: purchases.slice(0, limit),
    returns: returns.slice(0, limit),
    totals: {
      soldQty: sales.reduce((sum, line) => sum + line.qty, 0),
      soldValue: sales.reduce((sum, line) => sum + line.total, 0),
      boughtQty: purchases.reduce((sum, line) => sum + line.qty, 0),
      boughtValue: purchases.reduce((sum, line) => sum + line.total, 0),
      returnedQty: returns.reduce((sum, line) => sum + line.qty, 0),
      onHandValue: open.reduce((sum, batch) => sum + batch.left * batch.unitCost, 0),
      nextCost: open.length ? open[0].unitCost : null,
    },
  };
}
