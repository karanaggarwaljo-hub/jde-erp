import { requireOwner } from '@/lib/auth/dal';
import { convertQuotation, loadQuotation, saveQuotation } from '@/lib/quotation-server';

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
      return Response.json(await convertQuotation(body.quotationId, body.companyId));
    }
    if (body.action === 'save') return Response.json(await saveQuotation(body), { status: body.isEdit ? 200 : 201 });
    return Response.json({ error: 'Unknown quotation action.' }, { status: 400 });
  } catch (error) {
    console.error('POST /api/sales/quotation failed:', error);
    return Response.json({ error: errorMessage(error, 'Quotation action failed.') }, { status: 500 });
  }
}
