/**
 * Planning a cheque you are about to give: on which date it is safe to date it, and when you
 * usually date and give them. Pure — the server gathers the rows, this works out the rest.
 *
 * "Safe" is worked out from real money only:
 *
 *   in   what your sales bring in on a usual day of that weekday — the money actually received
 *        (customer payments, and what was paid at the counter on each bill) over recent weeks —
 *        plus the cheques you have received that fall due that day
 *   out  the cheques you have already given that fall due that day
 *
 * starting from what you say is in the bank today (nothing, if you leave it blank). A cheque dated
 * D is safe when, from D on, what is projected stays at or above its amount. Nothing is guessed:
 * with no sales history the "usual day" is zero, and the screen says how many days it is based on.
 */

import { dueDate, type ChequeRow } from './cheques';

export type CollectionDay = { date: string; amount: number };

export type CollectionPattern = {
  /** Usual money in on each weekday, Sunday first (0 = Sunday, as Date.getUTCDay). */
  byWeekday: number[];
  /** How many days of history the pattern is based on. */
  daysCovered: number;
  /** Money received over those days. */
  total: number;
};

export type PlanDay = {
  date: string;
  /** Usual money in from sales on this weekday (none for today itself). */
  expectedIn: number;
  chequesIn: number;
  chequesOut: number;
  /** Projected at the end of the day: the starting figure plus everything in, less everything out. */
  balance: number;
};

export type Suggestion = {
  /** The earliest date a cheque of this amount stays covered; null when it never is in the window. */
  date: string | null;
  /** When never covered: how much more would be needed by the end of the window. */
  shortBy: number;
};

export type PartyHabit = {
  /** Cheques given to them, as payments, with a date written on them. */
  count: number;
  /** Median days between the day a cheque was given and the date written on it. */
  postDatedDays: number | null;
  /** Median days between one cheque given to them and the next. */
  everyDays: number | null;
  last: { issuedOn: string; chequeDate: string | null; amount: number } | null;
};

const DAY_MS = 86_400_000;
const round2 = (value: number) => Math.round(value * 100) / 100;
const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** The usual money in on each weekday over the last `windowDays` before today, counted from the
 *  first day with any money in (so a business that started recently is not averaged with empty
 *  weeks from before it started). Days with no money in inside that span count as zero. */
export function collectionPattern(days: CollectionDay[], today: string, windowDays = 84): CollectionPattern {
  const windowStart = addDays(today, -windowDays);
  const inWindow = days.filter((day) => day.date >= windowStart && day.date < today && num(day.amount) !== 0);
  if (inWindow.length === 0) return { byWeekday: [0, 0, 0, 0, 0, 0, 0], daysCovered: 0, total: 0 };
  const first = inWindow.reduce((earliest, day) => (day.date < earliest ? day.date : earliest), inWindow[0].date);
  const daysCovered = daysBetween(first, today);
  const sums = [0, 0, 0, 0, 0, 0, 0];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (let index = 0; index < daysCovered; index += 1) counts[weekdayOf(addDays(first, index))] += 1;
  let total = 0;
  for (const day of inWindow) {
    sums[weekdayOf(day.date)] += num(day.amount);
    total += num(day.amount);
  }
  return { byWeekday: sums.map((sum, weekday) => (counts[weekday] ? round2(sum / counts[weekday]) : 0)), daysCovered, total: round2(total) };
}

/** Day by day from today for `horizon` days. A cheque still to clear that is dated before today
 *  is counted today: it can be presented at any time. Security cheques move no money. */
export function projectDays(input: { cheques: ChequeRow[]; pattern: CollectionPattern; today: string; startBalance: number; horizon?: number }): PlanDay[] {
  const { cheques, pattern, today } = input;
  const horizon = input.horizon ?? 60;
  const dueOn = new Map<string, { in: number; out: number }>();
  for (const cheque of cheques) {
    if (cheque.status !== 'pending' || cheque.purpose === 'security') continue;
    const day = dueDate(cheque) < today ? today : dueDate(cheque);
    const entry = dueOn.get(day) ?? { in: 0, out: 0 };
    entry[cheque.direction] += num(cheque.amount);
    dueOn.set(day, entry);
  }
  const out: PlanDay[] = [];
  let balance = num(input.startBalance);
  for (let index = 0; index <= horizon; index += 1) {
    const date = addDays(today, index);
    const expectedIn = index === 0 ? 0 : pattern.byWeekday[weekdayOf(date)];
    const due = dueOn.get(date) ?? { in: 0, out: 0 };
    balance += expectedIn + due.in - due.out;
    out.push({ date, expectedIn: round2(expectedIn), chequesIn: round2(due.in), chequesOut: round2(due.out), balance: round2(balance) });
  }
  return out;
}

/** The earliest day a new cheque of `amount` can be dated so that, from that day on, what is
 *  projected never drops below zero once it is paid. `notBefore` keeps it on or after a date. */
export function suggestDate(days: PlanDay[], amount: number, notBefore?: string | null): Suggestion {
  if (days.length === 0) return { date: null, shortBy: round2(amount) };
  // The lowest the projection reaches from each day to the end of the window.
  const lowestFrom: number[] = new Array(days.length);
  let lowest = Infinity;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    lowest = Math.min(lowest, days[index].balance);
    lowestFrom[index] = lowest;
  }
  for (let index = 0; index < days.length; index += 1) {
    if (notBefore && days[index].date < notBefore) continue;
    if (lowestFrom[index] - amount >= 0) return { date: days[index].date, shortBy: 0 };
  }
  return { date: null, shortBy: round2(amount - lowestFrom[days.length - 1]) };
}

/** Whether a cheque of `amount` dated `date` stays covered from that day to the end of the window. */
export function coveredOn(days: PlanDay[], amount: number, date: string): boolean {
  const from = days.filter((day) => day.date >= date);
  return from.length > 0 && from.every((day) => day.balance - amount >= 0);
}

/** How you usually pay someone by cheque: how far ahead you date them, and how often. With no
 *  party, across every cheque you have given as a payment. */
export function partyHabit(cheques: ChequeRow[], party?: string | null): PartyHabit {
  const wanted = (party ?? '').trim().toLowerCase();
  const given = cheques
    .filter((cheque) => cheque.direction === 'out' && cheque.purpose === 'payment' && cheque.status !== 'cancelled')
    .filter((cheque) => !wanted || cheque.party.trim().toLowerCase() === wanted)
    .sort((a, b) => a.issued_on.localeCompare(b.issued_on));
  const gaps = given.filter((cheque) => cheque.cheque_date).map((cheque) => Math.max(0, daysBetween(cheque.issued_on, cheque.cheque_date!)));
  const intervals: number[] = [];
  if (wanted) for (let index = 1; index < given.length; index += 1) intervals.push(daysBetween(given[index - 1].issued_on, given[index].issued_on));
  const last = given[given.length - 1];
  return {
    count: given.length,
    postDatedDays: median(gaps),
    everyDays: median(intervals.filter((days) => days > 0)),
    last: last ? { issuedOn: last.issued_on, chequeDate: last.cheque_date, amount: num(last.amount) } : null,
  };
}

export type DailyAverage = {
  /** Money in on an average day. */
  perDay: number;
  /** How many days it is averaged over. */
  days: number;
  total: number;
};

/** The money your sales bring in on an average day: everything received over the last
 *  `windowDays` before today, divided by the days in that span (counted from the first day with any
 *  money in, so a business that started recently is not averaged with empty weeks). One plain figure
 *  the owner can check and change, rather than a per-weekday pattern a few big sales can skew. */
export function dailyAverage(collections: CollectionDay[], today: string, windowDays = 30): DailyAverage {
  const windowStart = addDays(today, -windowDays);
  const inWindow = collections.filter((day) => day.date >= windowStart && day.date < today && num(day.amount) > 0);
  if (inWindow.length === 0) return { perDay: 0, days: 0, total: 0 };
  const first = inWindow.reduce((earliest, day) => (day.date < earliest ? day.date : earliest), inWindow[0].date);
  const days = Math.max(1, daysBetween(first, today));
  const total = inWindow.reduce((sum, day) => sum + num(day.amount), 0);
  return { perDay: round2(total / days), days, total: round2(total) };
}

/** The same money in every day: what projectDays needs from a single daily figure. */
export function flatPattern(perDay: number): CollectionPattern {
  const value = Math.max(0, num(perDay));
  return { byWeekday: [value, value, value, value, value, value, value], daysCovered: 0, total: 0 };
}

/** What makes up the projected figure at the end of `date`: the money in, split by where it comes
 *  from, and the cheques already given that will have been paid by then. */
export function breakdown(days: PlanDay[], date: string): { sales: number; chequesIn: number; chequesOut: number } {
  let sales = 0;
  let chequesIn = 0;
  let chequesOut = 0;
  for (const day of days) {
    if (day.date > date) break;
    sales += day.expectedIn;
    chequesIn += day.chequesIn;
    chequesOut += day.chequesOut;
  }
  return { sales: round2(sales), chequesIn: round2(chequesIn), chequesOut: round2(chequesOut) };
}
