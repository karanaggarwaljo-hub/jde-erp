import { dbErrorMessage, isBusinessRuleError, recordPurchasePayment } from '@/lib/db';
import { checkCompanyAccess } from '@/lib/auth/dal';

export const dynamic = 'force-dynamic';

/**
 * Records a payment against one purchase order. Everything that decides whether the payment is
 * allowed — the order exists, belongs to this company, still has a balance, and the amount does
 * not exceed it — lives in jde_record_purchase_payment, which locks the order first. What this
 * route validates is only the shape of the request, so a malformed body fails with a clear
 * message instead of reaching the database as a null or a string.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const companyId = body?.companyId;
  const poId = body?.poId;
  const amount = body?.amount;

  if (typeof companyId !== 'string' || !companyId.trim()) {
    return Response.json({ error: 'companyId is required.' }, { status: 400 });
  }
  if (typeof poId !== 'string' || !poId.trim()) {
    return Response.json({ error: 'poId is required.' }, { status: 400 });
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return Response.json({ error: 'Enter a payment amount greater than zero.' }, { status: 400 });
  }

  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  try {
    const po = await recordPurchasePayment({ companyId, poId, amount });
    return Response.json(po);
  } catch (error) {
    console.error('POST /api/purchases/pay failed:', error);
    // A rejected payment is a business rule the owner needs to read ("only ₹X still owing"),
    // not a crash — passed through rather than replaced with a generic failure.
    if (isBusinessRuleError(error)) return Response.json({ error: dbErrorMessage(error, 'This payment could not be recorded.') }, { status: 422 });
    return Response.json({ error: dbErrorMessage(error, 'Could not record this payment.') }, { status: 500 });
  }
}
