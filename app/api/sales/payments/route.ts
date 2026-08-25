import { dbErrorMessage, isBusinessRuleError, receiveCustomerPayment, deleteCustomerPayment, type PaymentAllocationInput } from '@/lib/db';
import { checkCompanyAccess } from '@/lib/auth/dal';

export const dynamic = 'force-dynamic';

function isAllocation(value: unknown): value is PaymentAllocationInput {
  return (
    typeof value === 'object' && value !== null &&
    typeof (value as { invoiceId?: unknown }).invoiceId === 'string' && (value as { invoiceId: string }).invoiceId.length > 0 &&
    typeof (value as { amount?: unknown }).amount === 'number' && Number.isFinite((value as { amount: number }).amount) && (value as { amount: number }).amount > 0
  );
}

/**
 * jde_receive_customer_payment validates the customer, every allocated invoice, and that the
 * allocations add up to the payment amount, then writes the payment, its allocations, each
 * invoice's paid/status, and the customer balance in one transaction. This handler never runs
 * those steps separately.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const { companyId, customerId, date, amount, note, allocations } = body ?? {};

  if (typeof companyId !== 'string' || !companyId) return Response.json({ error: 'companyId is required' }, { status: 400 });
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  if (typeof customerId !== 'string' || !customerId) return Response.json({ error: 'Choose a customer.' }, { status: 400 });
  if (typeof date !== 'string' || !date) return Response.json({ error: 'A payment date is required.' }, { status: 400 });
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return Response.json({ error: 'Payment amount must be greater than zero.' }, { status: 400 });
  }
  if (!Array.isArray(allocations) || allocations.length === 0 || !allocations.every(isAllocation)) {
    return Response.json({ error: 'Select at least one invoice, with an amount greater than zero, to apply this payment to.' }, { status: 400 });
  }

  try {
    const result = await receiveCustomerPayment({
      companyId,
      customerId,
      date,
      amount,
      note: typeof note === 'string' ? note.trim().slice(0, 500) : '',
      allocations,
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    console.error('POST /api/sales/payments failed:', error);
    if (isBusinessRuleError(error)) {
      return Response.json({ error: dbErrorMessage(error, 'This payment could not be recorded.') }, { status: 422 });
    }
    return Response.json({ error: dbErrorMessage(error, 'The payment was not saved.') }, { status: 500 });
  }
}

/**
 * jde_delete_customer_payment reverses every invoice this payment touched and corrects the
 * customer balance before removing the payment itself — for a payment entered wrong, not a
 * genuine refund (which belongs on its own transaction, not as an undo of this one).
 */
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({}));
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
  const paymentId = typeof body?.paymentId === 'string' ? body.paymentId : '';

  if (!companyId || !paymentId) return Response.json({ error: 'companyId and paymentId are required.' }, { status: 400 });
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  try {
    await deleteCustomerPayment(companyId, paymentId);
    return Response.json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/sales/payments failed:', error);
    if (isBusinessRuleError(error)) {
      return Response.json({ error: dbErrorMessage(error, 'This payment could not be reversed.') }, { status: 422 });
    }
    return Response.json({ error: dbErrorMessage(error, 'Failed to reverse this payment.') }, { status: 500 });
  }
}
