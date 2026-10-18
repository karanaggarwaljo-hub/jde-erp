/**
 * The cheque register's server side: entering a cheque when a payment is made by cheque, and a
 * cheque's life after that — cleared, bounced, stopped, returned. Server-only.
 *
 * A bounced or stopped cheque that paid something undoes that payment, because the money never
 * moved:
 *
 *   paid a supplier (supplier payment)        jde_reverse_supplier_payment — off the purchases it
 *                                             was put against, back on what you owe the supplier
 *   paid on a purchase (cash-book entry)      jde_unpay_purchase — the same for that purchase
 *   from a customer (payment received)        jde_delete_customer_payment — the bills are owed again
 *   from a customer at the counter (entry)    jde_unpay_invoice — that bill is owed again
 *   an expense                                marked only: the expense still happened, pay it again
 *
 * The register keeps the cheque, marked bounced and "payment undone", so the history stays even
 * though the payment is gone from every other screen.
 */

import { recordAudit, money as rupees } from './audit-log';
import {
  deleteCustomerPayment,
  deleteMoneyEntry,
  getCheque,
  getChequeForSource,
  getMoneyEntry,
  getMoneySourceRow,
  insertCheque,
  reverseSupplierPayment,
  setMoneyFields,
  unpayInvoice,
  unpayPurchase,
  updateCheque,
  type MoneySourceTable,
} from './db';
import { shopDay } from './logbook';
import type { ChequeRow, ChequeStatus } from './cheques';

type Money = { method: string; accountId: string | null; chequeNo: string | null; chequeDate: string | null };

/** Enters a cheque that paid (or was received as) a payment, an expense or a cash-book entry.
 *  Never throws: the payment is already saved. A leaf number already in the register is noted in
 *  the Log Book instead. */
export async function registerChequeFor(companyId: string, by: string, table: MoneySourceTable, id: string, money: Money, direction: 'in' | 'out'): Promise<void> {
  if (money.method !== 'cheque') return;
  try {
    const source = await getMoneySourceRow(companyId, table, id);
    if (!source) return;
    await insertCheque({
      company_id: companyId,
      direction,
      account_id: money.accountId,
      cheque_no: money.chequeNo?.replace(/\s+/g, '') || null,
      cheque_date: money.chequeDate,
      issued_on: /^\d{4}-\d{2}-\d{2}$/.test(source.date) ? source.date : shopDay(new Date()),
      party: source.party,
      party_type: source.partyType,
      amount: Math.round(source.amount * 100) / 100,
      purpose: 'payment',
      status: 'pending',
      source_table: table,
      source_id: id,
      created_by: by,
    });
  } catch (error) {
    const duplicate = error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505';
    console.error('Cheque register: entering the cheque failed:', error);
    await recordAudit({
      companyId, action: 'cheque.failed', entity: 'cheques', entityId: null,
      summary: duplicate
        ? `Cheque number ${money.chequeNo} is already in the register for that bank account — check the number on ${id}.`
        : `The cheque on ${id} could not be entered in the cheque register. Add it on the Cheques page.`,
    });
  }
}

const SOURCE_STATUS: Record<ChequeStatus, 'pending' | 'cleared' | 'bounced'> = {
  pending: 'pending', cleared: 'cleared', bounced: 'bounced', cancelled: 'bounced', returned: 'bounced',
};

export class ChequeError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'ChequeError';
  }
}

/** Undoes what a bounced or stopped cheque paid. Returns a sentence saying what was undone. */
async function undoPayment(companyId: string, cheque: ChequeRow): Promise<string | null> {
  if (cheque.reversed || cheque.purpose !== 'payment' || !cheque.source_table || !cheque.source_id) return null;
  const id = cheque.source_id;
  if (cheque.source_table === 'supplier_payments') {
    const result = await reverseSupplierPayment(companyId, id);
    return `Payment ${id} undone: ${rupees(Number(result.reversed_amount))} is owed to ${cheque.party} again.`;
  }
  if (cheque.source_table === 'payments_received') {
    await deleteCustomerPayment(companyId, id);
    return `Payment ${id} undone: ${rupees(Number(cheque.amount))} is owed by ${cheque.party} again.`;
  }
  if (cheque.source_table === 'money_entries') {
    const entry = await getMoneyEntry(companyId, id);
    if (!entry) return null;
    const amount = Math.abs(Number(entry.amount) || 0);
    if ((entry.kind === 'purchase_paid' || entry.kind === 'purchase_payment') && entry.source_id) {
      const taken = await unpayPurchase(companyId, entry.source_id, amount);
      await deleteMoneyEntry(companyId, id);
      return `${rupees(taken)} taken off purchase ${entry.source_id}: it is owed to ${cheque.party} again.`;
    }
    if (entry.kind === 'sale_counter' && entry.source_id && Number(entry.amount) > 0) {
      const taken = await unpayInvoice(companyId, entry.source_id, amount);
      await deleteMoneyEntry(companyId, id);
      return `${rupees(taken)} taken off bill ${entry.source_id}: it is owed by ${cheque.party} again.`;
    }
  }
  return null;
}

/** Moves a cheque on in its life. `date` is when it happened (cleared on, bounced on…). */
export async function setChequeStatus(companyId: string, by: string, chequeId: string, status: ChequeStatus, date?: string | null): Promise<{ cheque: ChequeRow; undone: string | null }> {
  const cheque = await getCheque(companyId, chequeId);
  if (!cheque) throw new ChequeError('That cheque is not in this company.', 404);
  if (cheque.status === status) return { cheque, undone: null };
  if (cheque.reversed && status !== 'bounced' && status !== 'cancelled') {
    throw new ChequeError('This cheque bounced and its payment was undone. Record the new payment instead.');
  }
  if (status === 'returned' && cheque.purpose !== 'security') throw new ChequeError('Only a security cheque is returned. A payment cheque clears, bounces or is stopped.');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? '')) ? String(date) : shopDay(new Date());

  // Bounced or stopped: the money never moved, so whatever it paid is undone first. If that
  // fails, the cheque keeps its old state, so the screen and the accounts never disagree.
  let undone: string | null = null;
  if (status === 'bounced' || status === 'cancelled') undone = await undoPayment(companyId, cheque);

  await updateCheque(companyId, cheque.id, { status, status_on: day, ...(undone ? { reversed: true } : {}) });
  // The payment's own record carries the state Cash & Bank reads, while it still exists.
  if (!undone && cheque.source_table && cheque.source_id) {
    await setMoneyFields(companyId, cheque.source_table as MoneySourceTable, cheque.source_id, {
      cheque_status: SOURCE_STATUS[status],
      cleared_on: status === 'cleared' ? day : null,
    }).catch((error) => console.error('Cheque register: updating the payment\'s cheque state failed:', error));
  }

  const label = { pending: 'marked not yet cleared', cleared: `cleared on ${day}`, bounced: 'bounced', cancelled: 'cancelled', returned: 'returned' }[status];
  await recordAudit({
    companyId, action: `cheque.${status}`, entity: 'cheques', entityId: cheque.id,
    summary: `Cheque ${cheque.cheque_no || '(no number)'} ${cheque.direction === 'out' ? 'to' : 'from'} ${cheque.party || 'someone'} for ${rupees(Number(cheque.amount))} ${label}${undone ? `. ${undone}` : ''}`,
    details: { cheque_no: cheque.cheque_no, amount: cheque.amount, source: cheque.source_id, by },
  });
  return { cheque: { ...cheque, status, status_on: day, reversed: cheque.reversed || Boolean(undone) }, undone };
}

/** The register row for a payment, expense or entry, if it was paid by cheque. */
export async function chequeForSource(companyId: string, table: MoneySourceTable, id: string): Promise<ChequeRow | null> {
  return getChequeForSource(companyId, table, id);
}
