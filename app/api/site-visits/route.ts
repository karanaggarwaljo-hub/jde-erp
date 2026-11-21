import { checkCompanyAccess } from '@/lib/auth/dal';
import { getStorefrontCompanyId, listSiteVisits, siteVisitNames } from '@/lib/db';
import { indiaDay, periodStart, summarizeVisits } from '@/lib/site-visits';

export const dynamic = 'force-dynamic';

const PERIODS = new Set([7, 30, 90]);

/**
 * The Website visits screen's numbers for one company: its counts for the last 7, 30 or 90 days,
 * summed and named (lib/site-visits.ts summarizeVisits). Visits are counted for the company the
 * website shows, so for any other company `storefront` is false and there is nothing to show.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const companyId = url.searchParams.get('companyId') ?? '';
  if (!companyId) return Response.json({ error: 'companyId is required' }, { status: 400 });
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  const asked = Number(url.searchParams.get('days'));
  const days = PERIODS.has(asked) ? asked : 30;

  try {
    const storefront = (await getStorefrontCompanyId()) === companyId;
    const to = indiaDay();
    const from = periodStart(days);
    const [rows, names] = await Promise.all([listSiteVisits(companyId, from, to), siteVisitNames(companyId)]);
    return Response.json({ storefront, period: days, from, to, ...summarizeVisits(rows, { from, to, ...names }) });
  } catch (error) {
    console.error('site-visits route failed:', error);
    return Response.json({ error: 'The visit counts could not be read. Please try again.' }, { status: 500 });
  }
}
