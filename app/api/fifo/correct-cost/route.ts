import { correctOldestLayerCost } from '@/lib/db';
import { requireOwnCompanyRow } from '@/lib/auth/dal';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { product_id, new_cost } = await request.json();
  if (typeof product_id !== 'string' || !product_id) {
    return Response.json({ error: 'product_id is required' }, { status: 400 });
  }
  if (typeof new_cost !== 'number' || !Number.isFinite(new_cost) || new_cost < 0) {
    return Response.json({ error: 'new_cost must be a non-negative number' }, { status: 400 });
  }
  const access = await requireOwnCompanyRow('products', product_id);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  const layer = await correctOldestLayerCost(product_id, new_cost);
  return Response.json({ layer });
}
