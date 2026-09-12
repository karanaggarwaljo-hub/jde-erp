import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import type { DayBookEntry, DayBookTotals } from '@/lib/daybook';

export type DayBookResponse = { entries: DayBookEntry[]; totals: DayBookTotals };

/** Every transaction of a period, assembled server-side. Dates are plain YYYY-MM-DD; blank ends
 *  mean open-ended, which is how "everything so far" is asked for. */
export async function getDayBook(companyId: string, from: string, to: string): Promise<DayBookResponse> {
  const params = new URLSearchParams({ companyId });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const response = await fetch(`/api/daybook?${params.toString()}`);
  return await parseJsonOrThrow(response, 'Could not load the day book') as DayBookResponse;
}
