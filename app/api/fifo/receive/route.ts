import { addStockLayer } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { product_id, qty, unit_cost, source_po_id, adjust_stock } = await request.json();
  if (typeof product_id !== 'string' || !product_id) {
    return Response.json({ error: 'product_id is required' }, { status: 400 });
  }
  if (typeof qty !== 'number' || !(qty > 0)) {
    return Response.json({ error: 'qty must be a positive number' }, { status: 400 });
  }
  if (typeof unit_cost !== 'number' || Number.isNaN(unit_cost)) {
    return Response.json({ error: 'unit_cost must be a number' }, { status: 400 });
  }
  const layer = await addStockLayer(product_id, qty, unit_cost, source_po_id ?? null, adjust_stock !== false);
  return Response.json(layer);
}
