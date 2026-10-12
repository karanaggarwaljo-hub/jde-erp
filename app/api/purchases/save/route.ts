import { dbErrorMessage, isBusinessRuleError, savePurchase } from '@/lib/db';
import { checkCompanyAccess } from '@/lib/auth/dal';
import { money, recordAudit } from '@/lib/audit-log';
import { after } from 'next/server';
import { attachBillToPurchase, isFileHash, sendBillToDriveQuietly } from '@/lib/purchase-bills';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json();
  const { companyId, supplierId, supplierName, date, receivedAt, items, total, paid, status, sourceFileHash, supplierInvoiceNo, supplierInvoiceDate } = body ?? {};

  if (typeof companyId !== 'string' || !companyId) {
    return Response.json({ error: 'companyId is required' }, { status: 400 });
  }
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
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
      supplierInvoiceNo: typeof supplierInvoiceNo === 'string' ? supplierInvoiceNo.trim().slice(0, 60) : null,
      supplierInvoiceDate: typeof supplierInvoiceDate === 'string' ? supplierInvoiceDate.trim().slice(0, 20) : null,
    });
    await recordAudit({
      companyId, action: 'purchase.create', entity: 'purchase_orders', entityId: String(po.id ?? ''),
      summary: `Recorded purchase ${String(po.id ?? '')} from ${String(supplierName ?? '')} at ${money(Number(po.total ?? 0))}`,
      details: { total: po.total, paid: po.paid, status: po.status, lines: Array.isArray(items) ? items.length : 0 },
    });
    // Entered from a scanned bill: that bill, kept when it was read, now belongs to this purchase
    // and goes to Google Drive under its name. After the answer, so saving is never slowed by it.
    const purchaseId = String(po.id ?? '');
    if (purchaseId && isFileHash(sourceFileHash)) {
      after(async () => {
        try {
          if (await attachBillToPurchase(companyId, sourceFileHash, purchaseId)) await sendBillToDriveQuietly(companyId, purchaseId);
        } catch (error) {
          console.error(`Attaching the scanned bill to ${purchaseId} failed:`, error);
        }
      });
    }
    return Response.json(po, { status: 201 });
  } catch (error) {
    console.error('POST /api/purchases/save failed:', error);
    if (isBusinessRuleError(error)) return Response.json({ error: dbErrorMessage(error, 'This purchase could not be recorded.') }, { status: 422 });
    return Response.json({ error: dbErrorMessage(error, 'Failed to record this purchase.') }, { status: 500 });
  }
}
