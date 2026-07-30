import { restoreStockForInvoiceItem } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { invoice_item_id } = await request.json();
  if (typeof invoice_item_id !== 'string' || !invoice_item_id) {
    return Response.json({ error: 'invoice_item_id is required' }, { status: 400 });
  }
  const restored_qty = await restoreStockForInvoiceItem(invoice_item_id);
  return Response.json({ restored_qty });
}
