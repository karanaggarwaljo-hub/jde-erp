import { dbErrorMessage, isBusinessRuleError, paySupplier, paySupplierInParts } from '@/lib/db';
import { checkCompanyAccess } from '@/lib/auth/dal';
import { money, recordAudit } from '@/lib/audit-log';
import { bankNamed, placeMoney } from '@/lib/cash-book';

export const dynamic = 'force-dynamic';

type ChequeIn = { chequeNo: string; chequeDate: string; amount: number };

/** The cheques of a payment made with several, or null when it was not paid that way. Each must
 *  have an amount above zero and the date written on it; the number may be blank. */
function readCheques(raw: unknown): ChequeIn[] | null | 'invalid' {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (raw.length > 24) return 'invalid';
  const cheques: ChequeIn[] = [];
  for (const item of raw) {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const amount = Number(row.amount);
    const chequeDate = typeof row.chequeDate === 'string' ? row.chequeDate.trim() : '';
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(chequeDate)) return 'invalid';
    cheques.push({ chequeNo: typeof row.chequeNo === 'string' ? row.chequeNo.trim().slice(0, 30) : '', chequeDate, amount: Math.round(amount * 100) / 100 });
  }
  return cheques;
}

/**
 * jde_pay_supplier writes the payment, its per-order allocations, every purchase order's paid
 * amount and the supplier's balance in one transaction, and refuses an amount larger than the
 * orders still owe. This handler never runs those steps separately — that is the whole point of
 * it existing. A repeated submission carrying the same `reference` returns the payment already
 * recorded rather than paying the supplier twice.
 *
 * Paid with several cheques (`cheques`, October 2026): each cheque becomes its own payment, all in
 * one transaction (jde_pay_supplier_in_parts), so a bounced cheque undoes only its own part. Each
 * is then entered in the cheque register, drawn on the bank chosen (or one named here, which is
 * added).
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
  const cheques = readCheques(body?.cheques);
  if (cheques === 'invalid') {
    return Response.json({ error: 'Every cheque needs an amount and the date written on it (at most 24 cheques).' }, { status: 400 });
  }
  if (cheques) {
    const total = Math.round(cheques.reduce((sum, cheque) => sum + cheque.amount * 100, 0)) / 100;
    if (Math.abs(total - amount) > 0.005) {
      return Response.json({ error: `The cheques add up to ₹${total.toLocaleString('en-IN')}, not ₹${amount.toLocaleString('en-IN')}.` }, { status: 400 });
    }
  }
  const cleanNote = typeof note === 'string' ? note.trim().slice(0, 500) : '';

  try {
    if (cheques) {
      const parts = await paySupplierInParts({
        companyId, supplierId, date, note: cleanNote, reference: reference.slice(0, 90), amounts: cheques.map((cheque) => cheque.amount),
      });
      // The bank the cheques are drawn on: one of the company's, or one named here for the first time.
      let accountId = typeof body?.accountId === 'string' ? body.accountId : '';
      const newBank = typeof body?.newBank === 'string' ? body.newBank.trim() : '';
      if (!accountId && newBank) accountId = (await bankNamed(companyId, newBank)).id;
      for (const part of parts) {
        const cheque = cheques[part.part - 1];
        await placeMoney(companyId, 'supplier_payments', String(part.payment_id), {
          method: 'cheque', accountId, chequeNo: cheque.chequeNo, chequeDate: cheque.chequeDate,
        }, access.user.email);
      }
      const paidTotal = parts.reduce((sum, part) => sum + Number(part.applied_total), 0);
      await recordAudit({
        companyId, action: 'supplier.payment', entity: 'supplier_payments', entityId: parts[0]?.payment_id ?? null,
        summary: `Paid ${money(paidTotal)} to a supplier with ${parts.length} cheque${parts.length === 1 ? '' : 's'}`,
        details: { supplier_id: supplierId, amount: paidTotal, date, payments: parts.map((part) => part.payment_id), cheques },
      });
      return Response.json({
        payment_id: parts[0]?.payment_id, applied_total: paidTotal,
        orders_paid: Math.max(0, ...parts.map((part) => Number(part.orders_paid) || 0)),
        cheques: parts.length,
      }, { status: 201 });
    }

    const result = await paySupplier({
      companyId,
      supplierId,
      date,
      amount,
      note: cleanNote,
      reference: reference.slice(0, 100),
    });
    // A cheque: into the cheque register (lib/cash-book.ts).
    await placeMoney(companyId, 'supplier_payments', String(result.payment_id), body?.money, access.user.email);
    await recordAudit({
      companyId, action: 'supplier.payment', entity: 'supplier_payments', entityId: result.payment_id,
      summary: `Paid ${money(result.applied_total)} to a supplier across ${result.orders_paid} purchase order${result.orders_paid === 1 ? '' : 's'}`,
      details: { supplier_id: supplierId, amount: result.applied_total, orders_paid: result.orders_paid, date },
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
