import { dbErrorMessage, deleteSalesInvoice } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json();
  const { invoiceId, customerId, outstanding } = body ?? {};

  if (typeof invoiceId !== 'string' || !invoiceId) {
    return Response.json({ error: 'invoiceId is required' }, { status: 400 });
  }

  try {
    await deleteSalesInvoice(invoiceId, customerId ?? null, Number(outstanding) || 0);
    return Response.json({ ok: true });
  } catch (error) {
    console.error('POST /api/sales/delete-invoice failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Failed to delete this invoice.') }, { status: 500 });
  }
}
