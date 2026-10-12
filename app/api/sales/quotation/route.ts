import { requireOwner } from '@/lib/auth/dal';
import { isBusinessRuleError } from '@/lib/db';
import { convertQuotation, loadQuotation, saveQuotation } from '@/lib/quotation-server';
import { after } from 'next/server';
import { money, recordAudit } from '@/lib/audit-log';
import { keepInvoicePdf } from '@/lib/invoice-drive';

export const dynamic = 'force-dynamic';

function errorMessage(error: unknown, fallback: string) {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : fallback;
}

export async function GET(request: Request) {
  await requireOwner();
  const url = new URL(request.url);
  const quotationId = url.searchParams.get('id');
  const companyId = url.searchParams.get('company_id');
  if (!quotationId || !companyId) return Response.json({ error: 'Quotation and company are required.' }, { status: 400 });
  try {
    return Response.json(await loadQuotation(quotationId, companyId));
  } catch (error) {
    console.error('GET /api/sales/quotation failed:', error);
    return Response.json({ error: errorMessage(error, 'Failed to load quotation.') }, { status: 500 });
  }
}

export async function POST(request: Request) {
  await requireOwner();
  const body = await request.json();
  if (typeof body?.companyId !== 'string' || !body.companyId) {
    return Response.json({ error: 'Active company is required.' }, { status: 400 });
  }
  try {
    if (body.action === 'convert') {
      if (typeof body.quotationId !== 'string' || !body.quotationId) {
        return Response.json({ error: 'Quotation is required.' }, { status: 400 });
      }
      const converted = await convertQuotation(body.quotationId, body.companyId);
      await recordAudit({
        companyId: body.companyId, action: 'quotation.convert', entity: 'quotations', entityId: body.quotationId,
        summary: `Turned quotation ${body.quotationId} into bill ${converted.invoiceId}`,
      });
      // A bill made this way is a bill like any other: it gets its PDF, and its Drive copy.
      if (converted.invoiceId) after(() => keepInvoicePdf(body.companyId, converted.invoiceId));
      return Response.json(converted);
    }
    if (body.action === 'save') {
      const saved = await saveQuotation(body);
      await recordAudit({
        companyId: body.companyId, action: body.isEdit ? 'quotation.edit' : 'quotation.create', entity: 'quotations', entityId: saved.id,
        summary: `${body.isEdit ? 'Changed' : 'Made'} quotation ${saved.id} for ${saved.customer || 'Walk-in Customer'} at ${money(Number(saved.total ?? 0))}`,
      });
      return Response.json(saved, { status: body.isEdit ? 200 : 201 });
    }
    return Response.json({ error: 'Unknown quotation action.' }, { status: 400 });
  } catch (error) {
    console.error('POST /api/sales/quotation failed:', error);
    if (isBusinessRuleError(error)) return Response.json({ error: errorMessage(error, 'This quotation action was rejected.') }, { status: 422 });
    return Response.json({ error: errorMessage(error, 'Quotation action failed.') }, { status: 500 });
  }
}
