import { restoreStockForInvoiceItem } from '@/lib/db';
import { requireOwnCompanyRow } from '@/lib/auth/dal';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { invoice_item_id } = await request.json();
  if (typeof invoice_item_id !== 'string' || !invoice_item_id) {
    return Response.json({ error: 'invoice_item_id is required' }, { status: 400 });
  }
  const access = await requireOwnCompanyRow('invoice_items', invoice_item_id);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  const restored_qty = await restoreStockForInvoiceItem(invoice_item_id);
  return Response.json({ restored_qty });
}
