import { dbErrorMessage, savePurchase } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json();
  const { companyId, poId, grnId, supplierId, supplierName, date, receivedAt, items, total, paid, status } = body ?? {};

  if (typeof companyId !== 'string' || !companyId) {
    return Response.json({ error: 'companyId is required' }, { status: 400 });
  }
  if (typeof poId !== 'string' || !poId) {
    return Response.json({ error: 'poId is required' }, { status: 400 });
  }
  if (typeof grnId !== 'string' || !grnId) {
    return Response.json({ error: 'grnId is required' }, { status: 400 });
  }
  if (!Array.isArray(items)) {
    return Response.json({ error: 'items must be an array' }, { status: 400 });
  }

  try {
    const po = await savePurchase({
      companyId,
      poId,
      grnId,
      supplierId: supplierId ?? null,
      supplierName: String(supplierName ?? ''),
      date: String(date ?? ''),
      receivedAt: String(receivedAt ?? ''),
      items,
      total: Number(total) || 0,
      paid: Number(paid) || 0,
      status: String(status ?? 'received'),
    });
    return Response.json(po, { status: 201 });
  } catch (error) {
    console.error('POST /api/purchases/save failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Failed to record this purchase.') }, { status: 500 });
  }
}
