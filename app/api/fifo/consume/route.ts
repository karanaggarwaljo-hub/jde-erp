import { consumeStockFifo } from '@/lib/db';
import { requireOwnCompanyRow } from '@/lib/auth/dal';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { product_id, qty, invoice_item_id } = await request.json();
  if (typeof product_id !== 'string' || !product_id) {
    return Response.json({ error: 'product_id is required' }, { status: 400 });
  }
  if (typeof qty !== 'number' || !(qty > 0)) {
    return Response.json({ error: 'qty must be a positive number' }, { status: 400 });
  }
  // No company_id came with this request — draining another company's stock given only a
  // guessed/known product id would otherwise need nothing else.
  const access = await requireOwnCompanyRow('products', product_id);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  const rows = await consumeStockFifo(product_id, qty, invoice_item_id ?? null);
  return Response.json(rows);
}
