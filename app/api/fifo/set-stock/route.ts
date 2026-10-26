import { dbErrorMessage, getRow, setProductStock } from '@/lib/db';
import { requireOwnCompanyRow } from '@/lib/auth/dal';
import { recordAudit } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

/** Sets a part's stock to a counted figure. The database works out the difference against the stock
 *  as it is at that moment (jde_set_product_stock), so a sale made on another computer while the
 *  Edit form was open is not undone: the form used to send the difference from what it showed. */
export async function POST(request: Request) {
  const { product_id, target, unit_cost } = await request.json().catch(() => ({}));
  if (typeof product_id !== 'string' || !product_id) {
    return Response.json({ error: 'product_id is required' }, { status: 400 });
  }
  if (typeof target !== 'number' || !Number.isFinite(target) || target < 0) {
    return Response.json({ error: 'The stock count must be zero or more.' }, { status: 400 });
  }
  if (typeof unit_cost !== 'number' || !Number.isFinite(unit_cost) || unit_cost < 0) {
    return Response.json({ error: 'unit_cost must be a non-negative number' }, { status: 400 });
  }
  const access = await requireOwnCompanyRow('products', product_id);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  try {
    const part = await getRow('products', product_id);
    const companyId = String(part?.company_id ?? '');
    const delta = await setProductStock(companyId, product_id, target, unit_cost);
    if (delta !== 0) {
      await recordAudit({
        companyId, action: 'products.stock', entity: 'products', entityId: product_id,
        summary: `Set the stock of ${String(part?.name ?? 'a part')} to ${target} (${delta > 0 ? '+' : ''}${delta})`,
        details: { target, delta },
      });
    }
    return Response.json({ delta });
  } catch (error) {
    console.error('POST /api/fifo/set-stock failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'The stock was not changed.') }, { status: 500 });
  }
}
