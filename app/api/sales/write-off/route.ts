import { dbErrorMessage, isBusinessRuleError, writeOffInvoiceBalance } from '@/lib/db';
import { checkCompanyAccess } from '@/lib/auth/dal';

export const dynamic = 'force-dynamic';

/**
 * Closes what is still owing on an invoice the customer settled by paying less. Whether it is
 * allowed — the invoice exists, belongs to this company, isn't a draft, still has a balance, and
 * the amount doesn't exceed it — is decided by jde_write_off_invoice_balance, which locks the
 * invoice first. This route validates the shape of the request only.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const companyId = body?.companyId;
  const invoiceId = body?.invoiceId;
  const amount = body?.amount;
  const reason = body?.reason;
  const date = body?.date;

  if (typeof companyId !== 'string' || !companyId.trim()) {
    return Response.json({ error: 'companyId is required.' }, { status: 400 });
  }
  if (typeof invoiceId !== 'string' || !invoiceId.trim()) {
    return Response.json({ error: 'invoiceId is required.' }, { status: 400 });
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return Response.json({ error: 'Enter an amount greater than zero to write off.' }, { status: 400 });
  }
  if (typeof reason !== 'undefined' && (typeof reason !== 'string' || reason.length > 500)) {
    return Response.json({ error: 'The reason must be 500 characters or fewer.' }, { status: 400 });
  }

  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  try {
    const result = await writeOffInvoiceBalance({
      companyId,
      invoiceId,
      amount,
      reason: typeof reason === 'string' ? reason : '',
      date: typeof date === 'string' ? date : '',
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    console.error('POST /api/sales/write-off failed:', error);
    // "only ₹X still owing" is something the owner needs to read, not a crash.
    if (isBusinessRuleError(error)) return Response.json({ error: dbErrorMessage(error, 'This settlement could not be recorded.') }, { status: 422 });
    return Response.json({ error: dbErrorMessage(error, 'Could not record this settlement.') }, { status: 500 });
  }
}
