import { checkCompanyAccess } from '@/lib/auth/dal';
import { dbErrorMessage, getPartCostSource } from '@/lib/db';
import { partCostHistory, partSales } from '@/lib/part-cost-history';
import { profitLines } from '@/lib/part-profit';
import { shopDay } from '@/lib/logbook';

export const dynamic = 'force-dynamic';
// "Last 90 days" counts in shop days (India time): the server itself runs on UTC.

/**
 * One part's cost history and earnings, for its window: every batch bought (supplier, date, price,
 * how much is left), whether the price is rising, each supplier's latest price, the stock's value
 * at cost, and what the part has sold and earned — all time and in the last 90 days.
 *
 *   ?companyId=…&productId=…
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const companyId = params.get('companyId') ?? '';
  const productId = params.get('productId') ?? '';
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  if (!productId) return Response.json({ error: 'productId is required.' }, { status: 400 });

  try {
    const source = await getPartCostSource(companyId, productId);
    if (!source) return Response.json({ error: 'That part is not in this company.' }, { status: 404 });
    // The bills this part is on come back whole (a bill discount is shared across every line), so
    // keep only this part's lines once their share has been worked out.
    const lines = profitLines({ ...source.sales, parts: [source.part] }).filter((line) => line.productId === productId);
    return Response.json(
      { history: partCostHistory(source.batches, source.purchases), sales: partSales(lines, shopDay(new Date())) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('GET /api/inventory/part-costs failed:', error);
    return Response.json({ error: dbErrorMessage(error, "This part's cost history could not be loaded.") }, { status: 500 });
  }
}
