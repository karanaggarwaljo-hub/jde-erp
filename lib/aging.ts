/** How overdue money is grouped — one definition, used by the Reports screen and by the CSV
 *  export.
 *
 *  These two had grown their own copies of the same thing: the same four buckets, the same
 *  boundaries, the same accumulation loop, written out twice. Nothing kept them in step, so
 *  changing a boundary in one would have left the exported spreadsheet quietly disagreeing with
 *  the report it was exported from — the kind of drift nobody notices until two numbers are put
 *  side by side in front of a customer.
 */

export const AGE_BUCKETS = ['0-30', '31-60', '61-90', '90+'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export function emptyBuckets(): Record<AgeBucket, number> {
  return { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
}

/** Boundaries are inclusive at the top: 30 days is still "0-30", 31 starts the next bucket. */
export function bucketFor(days: number): AgeBucket {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

/** Whole days from an invoice date to today, counted in UTC.
 *
 *  Both dates are pinned to UTC midnight rather than compared as local times. Invoice dates are
 *  stored as plain "YYYY-MM-DD" strings, which `new Date()` reads as UTC midnight, while a local
 *  `new Date()` for today carries a timezone offset — in India that is +5:30, so a bill dated
 *  today could measure as anything from 0 to nearly 1, and one dated exactly 30 days ago could
 *  land either side of the 30-day boundary depending on the hour the report was opened. */
export function daysOutstanding(dateIso: string, today: Date): number {
  const then = Date.parse(`${String(dateIso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(then)) return 0;
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

export type AgingEntry = { key: string; date: string; due: number };
export type Aging = { totals: Record<AgeBucket, number>; byKey: Map<string, Record<AgeBucket, number>> };

/** Groups what is owed by who owes it and how long it has been outstanding. Entries with nothing
 *  due are skipped rather than adding a row of zeroes for someone who is square with you. */
export function agingFrom(entries: AgingEntry[], today: Date): Aging {
  const totals = emptyBuckets();
  const byKey = new Map<string, Record<AgeBucket, number>>();
  for (const entry of entries) {
    if (!(entry.due > 0)) continue;
    const bucket = bucketFor(daysOutstanding(entry.date, today));
    totals[bucket] += entry.due;
    const row = byKey.get(entry.key) ?? emptyBuckets();
    row[bucket] += entry.due;
    byKey.set(entry.key, row);
  }
  return { totals, byKey };
}

/** The same grouping flattened for a spreadsheet: one row per name, one column per bucket, in
 *  the order AGE_BUCKETS declares — so the CSV's columns can never fall out of step with the
 *  headings the export writes above them. */
export function agingRows(entries: AgingEntry[], today: Date): Array<[string, ...number[]]> {
  const { byKey } = agingFrom(entries, today);
  return Array.from(byKey.entries()).map(([key, buckets]) => [key, ...AGE_BUCKETS.map((bucket) => buckets[bucket])]);
}
