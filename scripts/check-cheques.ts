/**
 * Exercises the cheque register end to end on a TEST company: receives a cheque from a customer
 * against one of their bills, checks it is in the register, bounces it, checks the payment was
 * undone (the bill and the customer owe it again), then removes the test cheque.
 *
 *   npx tsx --env-file=.env.local scripts/check-cheques.ts <companyId> <customerName> <invoiceId> <amount>
 */
import { getRow, listCheques, receiveCustomerPayment, getUserRecord } from '../lib/db';
import { placeMoney } from '../lib/cash-book';
import { setChequeStatus } from '../lib/cheque-register';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const [companyId, customerName, invoiceId, amountText] = process.argv.slice(2);
  const amount = Number(amountText);
  if (!companyId || !customerName || !invoiceId || !(amount > 0)) throw new Error('Pass company id, customer name, invoice id and amount.');
  void getUserRecord;
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: customer } = await db.from('jde_customers').select('id, balance').eq('company_id', companyId).eq('name', customerName).single();
  const before = { invoice: await getRow('invoices', invoiceId), balance: Number(customer!.balance) };
  console.log('before: paid', before.invoice?.paid, '| customer owes', before.balance);

  const payment = await receiveCustomerPayment({ companyId, customerId: customer!.id, date: new Date().toISOString().slice(0, 10), amount, note: 'check-cheques script', allocations: [{ invoiceId, amount }] });
  await placeMoney(companyId, 'payments_received', String(payment.payment_id), { method: 'cheque', chequeNo: '987654', chequeDate: '2026-10-25' }, 'check-script');
  const cheque = (await listCheques(companyId)).find((row) => row.source_id === payment.payment_id);
  const afterPay = await getRow('invoices', invoiceId);
  console.log('paid by cheque', payment.payment_id, '→ register:', cheque ? `${cheque.cheque_no} ${cheque.direction} ${cheque.status} ₹${cheque.amount} from ${cheque.party}` : 'MISSING', '| bill paid', afterPay?.paid);

  const result = await setChequeStatus(companyId, 'check-script', cheque!.id, 'bounced', null);
  const afterBounce = await getRow('invoices', invoiceId);
  const { data: customerAfter } = await db.from('jde_customers').select('balance').eq('id', customer!.id).single();
  const { count } = await db.from('jde_payments_received').select('id', { count: 'exact', head: true }).eq('id', payment.payment_id);
  console.log('bounced:', result.undone);
  console.log('after bounce: bill paid', afterBounce?.paid, '(was', before.invoice?.paid, ') | customer owes', Number(customerAfter!.balance), '(was', before.balance, ') | payment rows left', count, '| cheque', result.cheque.status, 'reversed', result.cheque.reversed);

  await db.from('jde_cheques').delete().eq('id', cheque!.id);
  console.log('test cheque removed');
}

main().catch((error) => { console.error(error); process.exit(1); });
