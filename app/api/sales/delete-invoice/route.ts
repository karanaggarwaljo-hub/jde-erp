import { dbErrorMessage, isBusinessRuleError, deleteSalesInvoice } from '@/lib/db';
import { checkCompanyAccess } from '@/lib/auth/dal';
import { recordAudit } from '@/lib/audit-log';
import { after } from 'next/server';
import { removeInvoicePdf } from '@/lib/invoice-archive';
import { binInvoicePdfInDrive } from '@/lib/invoice-drive';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json();
  const { companyId, invoiceId, customerId } = body ?? {};

  if (typeof companyId !== 'string' || !companyId) {
    return Response.json({ error: 'companyId is required' }, { status: 400 });
  }
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  if (typeof invoiceId !== 'string' || !invoiceId) {
    return Response.json({ error: 'invoiceId is required' }, { status: 400 });
  }

  try {
    await deleteSalesInvoice(companyId, invoiceId, customerId ?? null);
    await recordAudit({
      companyId, action: 'invoice.delete', entity: 'invoices', entityId: invoiceId,
      summary: `Deleted invoice ${invoiceId}`,
    });
    after(async () => {
      try {
        // The Drive copy first: it is found through the record the next line removes.
        await binInvoicePdfInDrive(companyId, invoiceId).catch((error) => console.error('Moving the Drive PDF of ' + invoiceId + ' to the Bin failed:', error));
        await removeInvoicePdf(companyId, invoiceId);
      } catch (error) {
        console.error('Removing the PDF of deleted invoice ' + invoiceId + ' failed:', error);
      }
    });
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
