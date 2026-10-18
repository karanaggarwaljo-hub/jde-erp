import { checkCompanyAccess } from '@/lib/auth/dal';
import { dbErrorMessage, getProfitSource } from '@/lib/db';
import { profitLines, profitTotals } from '@/lib/part-profit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reports → Profit: one line per invoice line in the period, each with what it sold for before
 * GST, what it cost from the batches it drew on, and its customer, part, category, brand and
 * suppliers — the screen groups and sorts them. Worked out here rather than in the browser
 * because customer returns (jde_sales_return_items) are not published to the browser.
 *
 *   ?companyId=…&from=YYYY-MM-DD&to=YYYY-MM-DD   (either day may be left out)
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const companyId = params.get('companyId') ?? '';
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) {
    return Response.json({ error: 'Dates must be written YYYY-MM-DD.' }, { status: 400 });
  }

  try {
    const source = await getProfitSource(companyId, { start: from || null, end: to || null });
    const lines = profitLines(source);
    return Response.json({ lines, totals: profitTotals(lines) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('GET /api/reports/profit failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'The profit report could not be worked out.') }, { status: 500 });
  }
}
