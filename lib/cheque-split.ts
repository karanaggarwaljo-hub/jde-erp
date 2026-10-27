/**
 * Paying one amount with several cheques. Pure, so the arithmetic can be tested on its own.
 *
 * The owner pays big supplier bills with several cheques, usually dated a month apart (October
 * 2026). The payment form lets them type the cheques one by one, or split the amount in one press:
 * equal whole-rupee cheques, the last one taking whatever is left over, numbered from the next free
 * leaves of the cheque book and dated at a chosen gap.
 */

export type ChequeDraft = {
  /** The leaf number, as written. May be blank: not every cheque book is in the ERP. */
  no: string;
  /** The date written on the cheque, YYYY-MM-DD. */
  date: string;
  /** As typed in the box, so a half-typed amount is not turned into a number too early. */
  amount: string;
};

export type DateGap = 'same' | 'week' | 'fortnight' | 'month';

export const DATE_GAP_LABEL: Record<DateGap, string> = {
  same: 'all the same date',
  week: 'a week apart',
  fortnight: '15 days apart',
  month: 'a month apart',
};

/** Most cheques one payment may be split into; the database refuses more. */
export const MAX_CHEQUES = 24;

const toPaise = (value: number) => Math.round((Number(value) || 0) * 100);

/** `total` in `count` cheques of equal whole rupees, the last taking the remainder (paise too).
 *  ₹1,00,000 in 3 is 33,333 + 33,333 + 33,334. Every cheque is more than zero, or none at all. */
export function splitAmount(total: number, count: number): number[] {
  const paise = toPaise(total);
  const n = Math.max(1, Math.min(MAX_CHEQUES, Math.floor(count)));
  if (paise <= 0) return [];
  const each = Math.floor(paise / n / 100) * 100;
  if (each <= 0) return [paise / 100];
  const amounts = Array.from({ length: n }, () => each);
  amounts[n - 1] = paise - each * (n - 1);
  return amounts.map((value) => value / 100);
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The same day of a later month, or that month's last day when it is shorter (31 Jan → 28 Feb). */
function addMonths(day: string, months: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date, lastDay));
  return target.toISOString().slice(0, 10);
}

/** `count` cheque dates starting on `first`, `gap` apart. */
export function spacedDates(first: string, count: number, gap: DateGap): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(first)) return Array.from({ length: count }, () => first);
  return Array.from({ length: count }, (_, index) => {
    if (gap === 'week') return addDays(first, 7 * index);
    if (gap === 'fortnight') return addDays(first, 15 * index);
    if (gap === 'month') return addMonths(first, index);
    return first;
  });
}

/** The number after a leaf number, keeping its leading zeros: "000101" → "000102". Not a plain
 *  number: blank, because guessing at someone's numbering is worse than leaving it to them. */
export function nextNumber(no: string): string {
  const match = /^(.*?)(\d+)$/.exec(no.trim());
  if (!match) return '';
  const [, prefix, digits] = match;
  return prefix + String(Number(digits) + 1).padStart(digits.length, '0');
}

/**
 * `count` cheques for `total`: split equally, dated from `firstDate` at `gap`, numbered from the
 * free leaves given (from the cheque book), or on from the first one typed when there are not
 * enough of them.
 */
export function planCheques(total: number, count: number, firstDate: string, gap: DateGap, freeLeaves: string[], firstNo = ''): ChequeDraft[] {
  const amounts = splitAmount(total, count);
  const dates = spacedDates(firstDate, amounts.length, gap);
  let previous = '';
  return amounts.map((amount, index) => {
    const no = freeLeaves[index] ?? (index === 0 ? firstNo : nextNumber(previous));
    previous = no;
    return { no, date: dates[index], amount: String(amount) };
  });
}

/** The cheques' amounts added up, in rupees to the paisa. */
export function chequesTotal(cheques: ChequeDraft[]): number {
  return cheques.reduce((sum, cheque) => sum + toPaise(Number(cheque.amount)), 0) / 100;
}

/** What is wrong with these cheques for paying `total`, in plain words, or null when they are fine. */
export function chequeProblem(cheques: ChequeDraft[], total: number): string | null {
  if (cheques.length === 0) return 'Add a cheque.';
  if (cheques.length > MAX_CHEQUES) return `At most ${MAX_CHEQUES} cheques in one payment.`;
  const badAmount = cheques.findIndex((cheque) => !(Number(cheque.amount) > 0));
  if (badAmount >= 0) return `Cheque ${badAmount + 1} needs an amount.`;
  const noDate = cheques.findIndex((cheque) => !/^\d{4}-\d{2}-\d{2}$/.test(cheque.date));
  if (noDate >= 0) return `Cheque ${noDate + 1} needs the date written on it.`;
  const numbers = cheques.map((cheque) => cheque.no.replace(/\s+/g, '')).filter(Boolean);
  const repeated = numbers.find((no, index) => numbers.indexOf(no) !== index);
  if (repeated) return `Cheque number ${repeated} is written twice.`;
  const difference = toPaise(total) - toPaise(chequesTotal(cheques));
  if (difference > 0) return `The cheques come to ₹${(difference / 100).toLocaleString('en-IN')} less than the amount.`;
  if (difference < 0) return `The cheques come to ₹${(-difference / 100).toLocaleString('en-IN')} more than the amount.`;
  return null;
}
