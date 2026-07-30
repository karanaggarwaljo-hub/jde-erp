import { consumeStockFifo } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { product_id, qty, invoice_item_id } = await request.json();
  if (typeof product_id !== 'string' || !product_id) {
    return Response.json({ error: 'product_id is required' }, { status: 400 });
  }
  if (typeof qty !== 'number' || !(qty > 0)) {
    return Response.json({ error: 'qty must be a positive number' }, { status: 400 });
  }
  const rows = await consumeStockFifo(product_id, qty, invoice_item_id ?? null);
  return Response.json(rows);
}
