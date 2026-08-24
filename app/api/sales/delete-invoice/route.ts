import { dbErrorMessage, isBusinessRuleError, deleteSalesInvoice } from '@/lib/db';

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
    // jde_delete_sales_invoice now refuses this on purpose once a payment has been recorded
    // against the invoice — that's a rule the owner can act on, not a fault.
    if (isBusinessRuleError(error)) {
      return Response.json({ error: dbErrorMessage(error, 'This invoice could not be deleted.') }, { status: 422 });
    }
    return Response.json({ error: dbErrorMessage(error, 'Failed to delete this invoice.') }, { status: 500 });
  }
}
