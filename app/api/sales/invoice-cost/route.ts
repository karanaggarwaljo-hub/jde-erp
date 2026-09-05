import { checkCompanyAccess } from '@/lib/auth/dal';
import { dbErrorMessage, getInvoiceCostRows } from '@/lib/db';
import { invoiceCostOfGoods } from '@/lib/invoice-profit';

export const dynamic = 'force-dynamic';

/**
 * What the goods on one invoice cost, from the FIFO batches they were drawn from.
 *
 * Read by the settle-and-close dialog so it can tell the owner what a sale made rather than only
 * what was written off. Read-only, and answers with `cost_known: false` rather than a zero when
 * any line has no recorded cost — the dialog then shows no profit figure at all, which is the
 * correct answer to "how much did I make" when the cost genuinely isn't known.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const companyId = params.get('companyId');
  const invoiceId = params.get('invoiceId');

  if (!companyId || !invoiceId) {
    return Response.json({ error: 'companyId and invoiceId are required.' }, { status: 400 });
  }

  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  try {
    const { items, consumptions } = await getInvoiceCostRows(companyId, invoiceId);
    return Response.json(invoiceCostOfGoods(items, consumptions));
  } catch (error) {
    console.error('GET /api/sales/invoice-cost failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Could not work out what this sale cost.') }, { status: 500 });
  }
}
