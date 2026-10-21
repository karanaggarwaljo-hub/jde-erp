import { after } from 'next/server';
import { cancelSalesInvoice, dbErrorMessage, deleteMoneyEntriesFor, getRow, isBusinessRuleError } from '@/lib/db';
import { checkCompanyAccess } from '@/lib/auth/dal';
import { money, recordAudit } from '@/lib/audit-log';
import { keepInvoicePdf } from '@/lib/invoice-drive';

export const dynamic = 'force-dynamic';

/**
 * Cancels an issued sales invoice (scripts/cancel-sales-invoice.sql). Under GST an issued invoice is
 * cancelled rather than deleted: it keeps its number and stays on record, marked cancelled, with a
 * copy of itself as issued. Its goods go back on the shelf and the customer no longer owes it, in
 * one database transaction. Refused while a payment, settlement or return is recorded against it.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
  const invoiceId = typeof body?.invoiceId === 'string' ? body.invoiceId : '';
  const customerId = typeof body?.customerId === 'string' && body.customerId ? body.customerId : null;
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
  if (!companyId) return Response.json({ error: 'companyId is required' }, { status: 400 });
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  if (!invoiceId) return Response.json({ error: 'invoiceId is required' }, { status: 400 });
  if (!reason) return Response.json({ error: 'Say why the invoice is being cancelled.' }, { status: 400 });

  try {
    const before = await getRow('invoices', invoiceId);
    await cancelSalesInvoice(companyId, invoiceId, customerId, reason);
    // A cheque taken at the counter on this bill no longer pays anything (lib/cash-book.ts).
    await deleteMoneyEntriesFor(companyId, 'invoice', invoiceId).catch((error) => console.error(`Removing the cheque records of cancelled ${invoiceId} failed:`, error));
    await recordAudit({
      companyId, action: 'invoice.cancel', entity: 'invoices', entityId: invoiceId,
      summary: `Cancelled ${invoiceId}${before ? ` (${String(before.customer ?? '')}, ${money(Number(before.total ?? 0))})` : ''}: ${reason}`,
      details: { reason, before: before ? { total: before.total, paid: before.paid, status: before.status } : null },
    });
    // Its saved PDF is redrawn, stamped CANCELLED, and the Drive copy follows. Never throws.
    after(() => keepInvoicePdf(companyId, invoiceId));
    return Response.json({ ok: true });
  } catch (error) {
    console.error('POST /api/sales/cancel-invoice failed:', error);
    if (isBusinessRuleError(error)) {
      return Response.json({ error: dbErrorMessage(error, 'This invoice could not be cancelled.') }, { status: 422 });
    }
    return Response.json({ error: dbErrorMessage(error, 'Failed to cancel this invoice.') }, { status: 500 });
  }
}
