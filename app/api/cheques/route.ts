import { requireOwner, checkCompanyAccess } from '@/lib/auth/dal';
import { money as rupees, recordAudit } from '@/lib/audit-log';
import { bankNamed, listBanks } from '@/lib/cash-book';
import { ChequeError, setChequeStatus } from '@/lib/cheque-register';
import { bookLeaves, normaliseChequeNo, type ChequeStatus } from '@/lib/cheques';
import {
  dbErrorMessage,
  deleteChequeBook,
  getCheque,
  getCollections,
  insertCheque,
  insertChequeBook,
  listChequeBooks,
  listCheques,
  updateCheque,
} from '@/lib/db';
import { shopDay } from '@/lib/logbook';
import { addDays } from '@/lib/cheque-plan';

export const dynamic = 'force-dynamic';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: ChequeStatus[] = ['pending', 'cleared', 'bounced', 'cancelled', 'returned'];
const textOf = (value: unknown, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const dayOf = (value: unknown, fallback: string | null) => (DAY.test(String(value ?? '')) ? String(value) : fallback);

/**
 * Cheques: the register of every cheque given and received, cheque books, and each cheque's life.
 * GET: cheques, books, the banks they are drawn on, and recent money in (for planning a cheque).
 * POST: the owner's actions.
 *
 * Owner-only (proxy.ts too). A cheque that pays something is entered by the payment itself
 * (lib/cash-book.ts); here the owner enters what pays nothing — a security cheque, or a spoiled
 * leaf — and moves cheques through their life (lib/cheque-register.ts). A bank is chosen from the
 * company's banks or named new (`newBank`), which adds it.
 */
export async function GET(request: Request) {
  await requireOwner();
  const companyId = new URL(request.url).searchParams.get('companyId') ?? '';
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  try {
    const today = shopDay(new Date());
    // The last twelve weeks of money in, for planning when a cheque is safe to date (lib/cheque-plan.ts).
    const [cheques, books, banks, collections] = await Promise.all([listCheques(companyId), listChequeBooks(companyId), listBanks(companyId), getCollections(companyId, addDays(today, -84))]);
    return Response.json({
      cheques, books, collections, today,
      banks: banks.map(({ id, name }) => ({ id, name })),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('GET /api/cheques failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'The cheque register could not be loaded.') }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  const body = await request.json().catch(() => ({}));
  const companyId = textOf(body?.companyId, 80);
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  const action = textOf(body?.action, 40);
  const bad = (error: string) => Response.json({ error }, { status: 400 });
  const today = shopDay(new Date());

  try {
    const banks = await listBanks(companyId);
    // The bank chosen from the list, or one named new, which is added.
    const bankAccount = async (id: unknown, name: unknown) => {
      const chosen = banks.find((bank) => bank.id === id);
      if (chosen) return chosen;
      const named = textOf(name, 80);
      return named ? bankNamed(companyId, named) : undefined;
    };

    if (action === 'status') {
      const status = body?.status as ChequeStatus;
      if (!STATUSES.includes(status)) return bad('Unknown cheque state.');
      const result = await setChequeStatus(companyId, owner.email, textOf(body?.id, 80), status, dayOf(body?.date, today));
      return Response.json(result);
    }

    if (action === 'add') {
      // What pays nothing: a security cheque given or taken. A cheque that pays is entered by
      // the payment (Pay a supplier, Receive a payment…), so the accounts move with it.
      const direction = body?.direction === 'in' ? 'in' : 'out';
      const account = direction === 'out' ? await bankAccount(body?.accountId, body?.newBank) : undefined;
      if (direction === 'out' && !account) return bad('Choose the bank the cheque is drawn on.');
      const party = textOf(body?.party, 120);
      if (!party) return bad(direction === 'out' ? 'Who is the cheque given to?' : 'Who gave the cheque?');
      const amount = Math.round((Number(body?.amount) || 0) * 100) / 100;
      if (amount < 0) return bad('The amount cannot be negative.');
      const created = await insertCheque({
        company_id: companyId, direction, account_id: account?.id ?? null, bank_name: direction === 'in' ? textOf(body?.bankName, 80) || null : null,
        cheque_no: normaliseChequeNo(textOf(body?.chequeNo, 30)) || null, cheque_date: dayOf(body?.chequeDate, null), issued_on: dayOf(body?.issuedOn, today)!,
        party, party_type: body?.partyType === 'supplier' || body?.partyType === 'customer' ? body.partyType : 'other',
        amount, purpose: 'security', status: 'pending', note: textOf(body?.note, 300) || null, created_by: owner.email,
      });
      await recordAudit({
        companyId, action: 'cheque.add', entity: 'cheques', entityId: created.id,
        summary: `${direction === 'out' ? 'Gave' : 'Took'} security cheque ${created.cheque_no || '(no number)'} ${direction === 'out' ? 'to' : 'from'} ${party}${amount ? ` for ${rupees(amount)}` : ''}`,
      });
      return Response.json(created, { status: 201 });
    }

    if (action === 'cancel-leaf') {
      const account = await bankAccount(body?.accountId, body?.newBank);
      if (!account) return bad('Choose the bank of the cheque book.');
      const chequeNo = normaliseChequeNo(textOf(body?.chequeNo, 30));
      if (!chequeNo) return bad('Enter the number of the leaf that was spoiled.');
      const created = await insertCheque({
        company_id: companyId, direction: 'out', account_id: account.id, cheque_no: chequeNo, issued_on: today, party: '', party_type: 'other',
        amount: 0, purpose: 'other', status: 'cancelled', status_on: today, note: textOf(body?.note, 300) || 'Spoiled leaf', created_by: owner.email,
      });
      await recordAudit({ companyId, action: 'cheque.cancelled', entity: 'cheques', entityId: created.id, summary: `Cancelled leaf ${chequeNo} of "${account.name}" (not used)` });
      return Response.json(created, { status: 201 });
    }

    if (action === 'edit') {
      const cheque = await getCheque(companyId, textOf(body?.id, 80));
      if (!cheque) return bad('That cheque is not in this company.');
      const patch: Record<string, unknown> = {};
      if (typeof body?.chequeNo === 'string') patch.cheque_no = normaliseChequeNo(textOf(body.chequeNo, 30)) || null;
      if (body?.chequeDate !== undefined) patch.cheque_date = dayOf(body.chequeDate, null);
      if (typeof body?.note === 'string') patch.note = textOf(body.note, 300) || null;
      await updateCheque(companyId, cheque.id, patch);
      await recordAudit({
        companyId, action: 'cheque.edit_cheque', entity: 'cheques', entityId: cheque.id,
        summary: `Changed cheque ${cheque.cheque_no || '(no number)'} to ${cheque.party || 'someone'}`,
        details: { before: { cheque_no: cheque.cheque_no, cheque_date: cheque.cheque_date, note: cheque.note }, after: patch },
      });
      return Response.json({ ok: true });
    }

    if (action === 'add-book') {
      const account = await bankAccount(body?.accountId, body?.newBank);
      if (!account) return bad('Choose or name the bank the book is for.');
      const firstNo = normaliseChequeNo(textOf(body?.firstNo, 30));
      const lastNo = normaliseChequeNo(textOf(body?.lastNo, 30));
      if (bookLeaves({ first_no: firstNo, last_no: lastNo }).length === 0) return bad('Enter the first and last cheque numbers of the book (up to 500 leaves).');
      const book = await insertChequeBook({ company_id: companyId, account_id: account.id, first_no: firstNo, last_no: lastNo, received_on: dayOf(body?.receivedOn, today)!, note: textOf(body?.note, 200) || null });
      await recordAudit({ companyId, action: 'cheque.book', entity: 'cheque_books', entityId: book.id, summary: `Added a cheque book for "${account.name}": ${firstNo} to ${lastNo}` });
      return Response.json(book, { status: 201 });
    }

    if (action === 'delete-book') {
      const books = await listChequeBooks(companyId);
      const book = books.find((entry) => entry.id === body?.id);
      if (!book) return bad('That cheque book is not in this company.');
      await deleteChequeBook(companyId, book.id);
      await recordAudit({ companyId, action: 'cheque.book', entity: 'cheque_books', entityId: book.id, summary: `Removed the cheque book ${book.first_no} to ${book.last_no} (the cheques written from it stay in the register)` });
      return Response.json({ ok: true });
    }

    return bad('Unknown action.');
  } catch (error) {
    if (error instanceof ChequeError) return Response.json({ error: error.message }, { status: error.status });
    const duplicate = error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505';
    if (duplicate) return bad('That cheque number is already in the register for this bank.');
    console.error(`POST /api/cheques (${action}) failed:`, error);
    return Response.json({ error: dbErrorMessage(error, 'The cheque register could not be updated.') }, { status: 500 });
  }
}
