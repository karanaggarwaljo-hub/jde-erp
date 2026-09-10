import { dbErrorMessage, isBusinessRuleError, paySupplier } from '@/lib/db';
import { checkCompanyAccess } from '@/lib/auth/dal';

export const dynamic = 'force-dynamic';

/**
 * jde_pay_supplier writes the payment, its per-order allocations, every purchase order's paid
 * amount and the supplier's balance in one transaction, and refuses an amount larger than the
 * orders still owe. This handler never runs those steps separately — that is the whole point of
 * it existing. A repeated submission carrying the same `reference` returns the payment already
 * recorded rather than paying the supplier twice.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const { companyId, supplierId, date, amount, note, reference } = body ?? {};

  if (typeof companyId !== 'string' || !companyId) return Response.json({ error: 'companyId is required' }, { status: 400 });
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  if (typeof supplierId !== 'string' || !supplierId) return Response.json({ error: 'Choose a supplier.' }, { status: 400 });
  if (typeof date !== 'string' || !date) return Response.json({ error: 'A payment date is required.' }, { status: 400 });
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return Response.json({ error: 'Payment amount must be greater than zero.' }, { status: 400 });
  }
  if (typeof reference !== 'string' || !reference) {
    return Response.json({ error: 'A payment reference is required.' }, { status: 400 });
  }

  try {
    const result = await paySupplier({
      companyId,
      supplierId,
      date,
      amount,
      note: typeof note === 'string' ? note.trim().slice(0, 500) : '',
      reference: reference.slice(0, 100),
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    console.error('POST /api/suppliers/payments failed:', error);
    if (isBusinessRuleError(error)) {
      return Response.json({ error: dbErrorMessage(error, 'This payment could not be recorded.') }, { status: 422 });
    }
    return Response.json({ error: dbErrorMessage(error, 'The payment was not saved.') }, { status: 500 });
  }
}
