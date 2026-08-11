import { dbErrorMessage, savePurchase } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json();
  const { companyId, supplierId, supplierName, date, receivedAt, items, total, paid, status, sourceFileHash } = body ?? {};

  if (typeof companyId !== 'string' || !companyId) {
    return Response.json({ error: 'companyId is required' }, { status: 400 });
  }
  if (!Array.isArray(items)) {
    return Response.json({ error: 'items must be an array' }, { status: 400 });
  }

  try {
    const po = await savePurchase({
      companyId,
      supplierId: supplierId ?? null,
      supplierName: String(supplierName ?? ''),
      date: String(date ?? ''),
      receivedAt: String(receivedAt ?? ''),
      items,
      total: Number(total) || 0,
      paid: Number(paid) || 0,
      status: String(status ?? 'received'),
      sourceFileHash: sourceFileHash ?? null,
    });
    return Response.json(po, { status: 201 });
  } catch (error) {
    console.error('POST /api/purchases/save failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Failed to record this purchase.') }, { status: 500 });
  }
}
