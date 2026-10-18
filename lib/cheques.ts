/**
 * Cheque management: the register of cheques given and received, cheque books and their leaves,
 * and what is coming due. Pure — the server gathers the rows, this works out the rest.
 */

export type ChequeDirection = 'out' | 'in';
export type ChequeStatus = 'pending' | 'cleared' | 'bounced' | 'cancelled' | 'returned';
export type ChequePurpose = 'payment' | 'security' | 'advance' | 'other';

export type ChequeRow = {
  id: string;
  direction: ChequeDirection;
  account_id: string | null;
  bank_name: string | null;
  cheque_no: string | null;
  cheque_date: string | null;
  issued_on: string;
  party: string;
  party_type: 'supplier' | 'customer' | 'other' | null;
  amount: number | string;
  purpose: ChequePurpose;
  status: ChequeStatus;
  status_on: string | null;
  source_table: string | null;
  source_id: string | null;
  reversed: boolean;
  note: string | null;
  created_at: string;
};

export type ChequeBook = { id: string; account_id: string; first_no: string; last_no: string; received_on: string; note: string | null };

export const STATUS_LABEL: Record<ChequeStatus, string> = {
  pending: 'Not yet cleared',
  cleared: 'Cleared',
  bounced: 'Bounced',
  cancelled: 'Cancelled',
  returned: 'Returned',
};
export const PURPOSE_LABEL: Record<ChequePurpose, string> = { payment: 'Payment', security: 'Security cheque', advance: 'Advance', other: 'Other' };

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Cheque numbers keep their leading zeros ("000123"), so they are handled as text of a width. */
export function normaliseChequeNo(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '').trim();
}

/** The leaves of a book, in order. Empty when the range is not two numbers, or absurdly long. */
export function bookLeaves(book: Pick<ChequeBook, 'first_no' | 'last_no'>): string[] {
  const first = normaliseChequeNo(book.first_no);
  const last = normaliseChequeNo(book.last_no);
  if (!/^\d+$/.test(first) || !/^\d+$/.test(last)) return [];
  const start = Number(first);
  const end = Number(last);
  if (end < start || end - start > 500) return [];
  const width = Math.max(first.length, last.length);
  return Array.from({ length: end - start + 1 }, (_, index) => String(start + index).padStart(width, '0'));
}

export type LeafState = { no: string; cheque: ChequeRow | null };

/** Every leaf of a book with the cheque written on it, if any. */
export function leavesOf(book: ChequeBook, cheques: ChequeRow[]): LeafState[] {
  const used = new Map(
    cheques
      .filter((cheque) => cheque.direction === 'out' && cheque.account_id === book.account_id)
      .map((cheque) => [normaliseChequeNo(cheque.cheque_no), cheque]),
  );
  return bookLeaves(book).map((no) => ({ no, cheque: used.get(no) ?? null }));
}

/** The first unused leaf across an account's books, oldest book first; null when none is left. */
export function nextLeaf(books: ChequeBook[], cheques: ChequeRow[], accountId: string): string | null {
  const own = books.filter((book) => book.account_id === accountId).sort((a, b) => a.received_on.localeCompare(b.received_on) || Number(a.first_no) - Number(b.first_no));
  for (const book of own) {
    const free = leavesOf(book, cheques).find((leaf) => !leaf.cheque);
    if (free) return free.no;
  }
  return null;
}

export function dueDate(cheque: ChequeRow): string {
  return (cheque.cheque_date || cheque.issued_on).slice(0, 10);
}

export function daysUntil(day: string, today: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export type ChequeSummary = {
  pendingCount: number;
  pendingTotal: number;
  /** Pending, with the date on the cheque within the next `days` (or already past). */
  dueSoonCount: number;
  dueSoonTotal: number;
  /** Pending, dated after the coming week: post-dated. */
  postDatedCount: number;
  postDatedTotal: number;
  bouncedCount: number;
  bouncedTotal: number;
};

/** Money only: security cheques are not counted as money owed or coming. */
export function summarise(cheques: ChequeRow[], direction: ChequeDirection, today: string, days = 7): ChequeSummary {
  const out: ChequeSummary = { pendingCount: 0, pendingTotal: 0, dueSoonCount: 0, dueSoonTotal: 0, postDatedCount: 0, postDatedTotal: 0, bouncedCount: 0, bouncedTotal: 0 };
  for (const cheque of cheques) {
    if (cheque.direction !== direction || cheque.purpose === 'security') continue;
    const amount = num(cheque.amount);
    if (cheque.status === 'bounced') {
      out.bouncedCount += 1;
      out.bouncedTotal += amount;
    }
    if (cheque.status !== 'pending') continue;
    out.pendingCount += 1;
    out.pendingTotal += amount;
    if (daysUntil(dueDate(cheque), today) <= days) {
      out.dueSoonCount += 1;
      out.dueSoonTotal += amount;
    } else {
      out.postDatedCount += 1;
      out.postDatedTotal += amount;
    }
  }
  for (const key of Object.keys(out) as Array<keyof ChequeSummary>) out[key] = round2(out[key]);
  return out;
}

export type Shortfall = { accountId: string; byDate: string; due: number; balance: number; short: number };

/** For each bank account: will its cleared balance cover the cheques given from it that fall due
 *  in the next `days`? Lists only the accounts that would fall short. */
export function shortfalls(cheques: ChequeRow[], balances: Record<string, number>, today: string, days = 7): Shortfall[] {
  const byAccount = new Map<string, { due: number; last: string }>();
  for (const cheque of cheques) {
    if (cheque.direction !== 'out' || cheque.status !== 'pending' || cheque.purpose === 'security' || !cheque.account_id) continue;
    const day = dueDate(cheque);
    if (daysUntil(day, today) > days) continue;
    const entry = byAccount.get(cheque.account_id) ?? { due: 0, last: day };
    entry.due += num(cheque.amount);
    if (day > entry.last) entry.last = day;
    byAccount.set(cheque.account_id, entry);
  }
  const out: Shortfall[] = [];
  for (const [accountId, entry] of byAccount) {
    const balance = round2(balances[accountId] ?? 0);
    const short = round2(entry.due - balance);
    if (short > 0) out.push({ accountId, byDate: entry.last, due: round2(entry.due), balance, short });
  }
  return out;
}

/** The order the register lists cheques in: not-yet-cleared first by the date on the cheque, then
 *  everything else newest first. */
export function registerOrder(cheques: ChequeRow[]): ChequeRow[] {
  return [...cheques].sort((a, b) => {
    const aOpen = a.status === 'pending' ? 0 : 1;
    const bOpen = b.status === 'pending' ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    if (aOpen === 0) return dueDate(a).localeCompare(dueDate(b));
    return (b.status_on ?? b.issued_on).localeCompare(a.status_on ?? a.issued_on);
  });
}
