import { addStockLayer } from '@/lib/db';
import { requireOwnCompanyRow } from '@/lib/auth/dal';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { product_id, qty, unit_cost, source_po_id, adjust_stock } = await request.json();
  if (typeof product_id !== 'string' || !product_id) {
    return Response.json({ error: 'product_id is required' }, { status: 400 });
  }
  if (typeof qty !== 'number' || !(qty > 0)) {
    return Response.json({ error: 'qty must be a positive number' }, { status: 400 });
  }
  if (typeof unit_cost !== 'number' || !Number.isFinite(unit_cost) || unit_cost < 0) {
    return Response.json({ error: 'unit_cost must be a non-negative number' }, { status: 400 });
  }
  // Fabricating stock at a chosen cost for a product needs nothing but its id today — this
  // stops that id being one belonging to a different company.
  const access = await requireOwnCompanyRow('products', product_id);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  const layer = await addStockLayer(product_id, qty, unit_cost, source_po_id ?? null, adjust_stock !== false);
  return Response.json(layer);
}
