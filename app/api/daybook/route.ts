import { checkCompanyAccess } from '@/lib/auth/dal';
import { dbErrorMessage, getDayBookRows } from '@/lib/db';
import { buildDayBook, dayBookTotals, withinRange, type DayBookSources } from '@/lib/daybook';

export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every transaction of a period, from every part of the business, assembled server-side.
 *
 * One request rather than ten: several of these tables are deliberately not reachable from the
 * browser at all (supplier payments and the settlement audit trail), and the screen would have to
 * make a round trip per table even for the ones that are.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const companyId = params.get('companyId');
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';

  if (!companyId) return Response.json({ error: 'companyId is required.' }, { status: 400 });
  for (const [name, value] of [['from', from], ['to', to]] as const) {
    if (value && !ISO_DATE.test(value)) {
      return Response.json({ error: `${name} must be a date like 2026-09-12.` }, { status: 400 });
    }
  }
  if (from && to && from > to) {
    return Response.json({ error: 'The start date is after the end date.' }, { status: 400 });
  }

  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  try {
    const rows = await getDayBookRows(companyId, from, to);
    // Returns were fetched a day wide on each side so nothing near a midnight boundary is lost;
    // the range is applied again here, once each row carries its true Indian calendar date.
    const entries = withinRange(buildDayBook(rows as unknown as DayBookSources), from, to);
    return Response.json({ entries, totals: dayBookTotals(entries) });
  } catch (error) {
    console.error('GET /api/daybook failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Could not load the day book.') }, { status: 500 });
  }
}
