import { createHash } from 'node:crypto';
import { after } from 'next/server';
import { checkCompanyAccess } from '@/lib/auth/dal';
import { recordAudit } from '@/lib/audit-log';
import { dbErrorMessage, getPurchaseForBill } from '@/lib/db';
import { BillError, billsByPurchase, isBillMimeType, isFileHash, keepBill, MAX_BILL_BYTES, openBill, sendBillToDriveQuietly } from '@/lib/purchase-bills';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * A purchase's supplier bill — the photo or PDF it was entered from.
 *
 *   GET ?companyId&purchaseId     the file itself, to view on any device signed in to the ERP
 *   GET ?companyId&list=1         which purchases have a bill, for the Purchases list
 *   POST                          attach a bill to a purchase that has none
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const companyId = params.get('companyId') ?? '';
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  try {
    if (params.get('list') === '1') return Response.json(await billsByPurchase(companyId));

    const purchaseId = params.get('purchaseId') ?? '';
    if (!purchaseId) return Response.json({ error: 'purchaseId is required.' }, { status: 400 });
    const bill = await openBill(companyId, purchaseId);
    await recordAudit({
      companyId, action: 'bill.open', entity: 'purchase_orders', entityId: purchaseId,
      summary: `Opened the supplier bill of ${purchaseId}`,
    });
    const body = bill.bytes.buffer.slice(bill.bytes.byteOffset, bill.bytes.byteOffset + bill.bytes.byteLength) as ArrayBuffer;
    return new Response(body, {
      headers: {
        'Content-Type': bill.mimeType,
        'Content-Disposition': `inline; filename="${bill.fileName.replace(/[^A-Za-z0-9 ._-]/g, '')}"`,
        'Content-Length': String(bill.bytes.byteLength),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof BillError) return Response.json({ error: error.message }, { status: error.status });
    console.error('GET /api/purchases/bill failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'The supplier bill could not be opened.') }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const companyId = String(body?.companyId ?? '');
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  const purchaseId = String(body?.purchaseId ?? '');
  const mimeType = body?.mimeType;
  const base64 = typeof body?.base64 === 'string' ? body.base64 : '';
  if (!purchaseId || !base64) return Response.json({ error: 'purchaseId and the file are required.' }, { status: 400 });
  if (!isBillMimeType(mimeType)) return Response.json({ error: 'Attach a photo (JPG, PNG, WebP) or a PDF of the bill.' }, { status: 400 });

  try {
    const purchase = await getPurchaseForBill(companyId, purchaseId);
    if (!purchase) return Response.json({ error: 'That purchase is not in this company.' }, { status: 404 });
    const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
    if (bytes.byteLength === 0) return Response.json({ error: 'The file was empty.' }, { status: 400 });
    if (bytes.byteLength > MAX_BILL_BYTES) return Response.json({ error: 'This file is over 5 MB. Take a photo of the bill instead, or save the PDF smaller.' }, { status: 413 });
    // The browser hashes the original file; when it did not, the bytes received stand in for it.
    const fileHash = isFileHash(body?.fileHash) ? body.fileHash : createHash('sha256').update(bytes).digest('hex');
    const fileName = typeof body?.fileName === 'string' ? body.fileName : '';

    await keepBill({ companyId, fileHash, bytes, mimeType, fileName, purchaseId, by: access.user.email });
    await recordAudit({
      companyId, action: 'bill.attach', entity: 'purchase_orders', entityId: purchaseId,
      summary: `Attached the supplier bill of ${purchaseId} (${purchase.supplier})`,
      details: { file: fileName, size_bytes: bytes.byteLength },
    });
    after(() => sendBillToDriveQuietly(companyId, purchaseId));
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof BillError) return Response.json({ error: error.message }, { status: error.status });
    console.error('POST /api/purchases/bill failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'The supplier bill could not be attached.') }, { status: 500 });
  }
}
