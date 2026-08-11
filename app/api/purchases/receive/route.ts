import { dbErrorMessage, receivePurchaseStock } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json();
  const { companyId, poId, supplierName, receivedAt, items } = body ?? {};

  if (typeof companyId !== 'string' || !companyId) {
    return Response.json({ error: 'companyId is required' }, { status: 400 });
  }
  if (typeof poId !== 'string' || !poId) {
    return Response.json({ error: 'poId is required' }, { status: 400 });
  }
  if (!Array.isArray(items)) {
    return Response.json({ error: 'items must be an array' }, { status: 400 });
  }

  try {
    const po = await receivePurchaseStock({
      companyId,
      poId,
      supplierName: String(supplierName ?? ''),
      receivedAt: String(receivedAt ?? ''),
      items,
    });
    return Response.json(po);
  } catch (error) {
    console.error('POST /api/purchases/receive failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Failed to mark this purchase received.') }, { status: 500 });
  }
}
