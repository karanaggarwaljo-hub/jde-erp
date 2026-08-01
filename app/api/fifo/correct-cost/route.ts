import { correctOldestLayerCost } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { product_id, new_cost } = await request.json();
  if (typeof product_id !== 'string' || !product_id) {
    return Response.json({ error: 'product_id is required' }, { status: 400 });
  }
  if (typeof new_cost !== 'number' || Number.isNaN(new_cost)) {
    return Response.json({ error: 'new_cost must be a number' }, { status: 400 });
  }
  const layer = await correctOldestLayerCost(product_id, new_cost);
  return Response.json({ layer });
}
