import { createClient } from '@supabase/supabase-js';
import { requireOwner } from '@/lib/auth/dal';
import { isBusinessRuleError } from '@/lib/db';

export const dynamic = 'force-dynamic';

type ReturnLine = { invoice_item_id: string; qty: number };

function getDatabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return fallback;
}

/** Returnable quantity is always calculated server-side from prior posted returns. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const invoiceId = params.get('returnInvoiceId');
  const companyId = params.get('returnCompanyId');
  if (!invoiceId || !companyId) return Response.json({ error: 'returnCompanyId and returnInvoiceId are required.' }, { status: 400 });
  await requireOwner();

  try {
    const { data, error } = await getDatabase().rpc('jde_get_sales_returnable_items', {
      p_company_id: companyId,
      p_invoice_id: invoiceId,
    });
    if (error) throw error;
    return Response.json(data ?? []);
  } catch (error) {
    console.error('GET /api/sales (return items) failed:', error);
    return Response.json({ error: errorMessage(error, 'Could not load the returnable invoice items.') }, { status: 500 });
  }
}

/**
 * `jde_create_sales_return` validates the invoice/company/remaining quantity and writes the
 * credit note, restored FIFO stock and customer balance adjustment in one transaction. This
 * handler never runs those irreversible operations one by one.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'A valid JSON return request is required.' }, { status: 400 });
  }
  const value = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const companyId = typeof value.companyId === 'string' ? value.companyId : '';
  const invoiceId = typeof value.invoiceId === 'string' ? value.invoiceId : '';
  const customerId = typeof value.customerId === 'string' ? value.customerId : null;
  const reason = typeof value.reason === 'string' ? value.reason.trim().slice(0, 500) : '';
  const rawItems = Array.isArray(value.items) ? value.items : [];
  const items: ReturnLine[] = rawItems.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const line = raw as Record<string, unknown>;
    const invoiceItemId = typeof line.invoice_item_id === 'string' ? line.invoice_item_id : '';
    const qty = Number(line.qty);
    return invoiceItemId && Number.isFinite(qty) && qty > 0 && Number.isInteger(qty)
      ? [{ invoice_item_id: invoiceItemId, qty }]
      : [];
  });
  if (!companyId || !invoiceId) return Response.json({ error: 'companyId and invoiceId are required.' }, { status: 400 });
  await requireOwner();
  if (!reason) return Response.json({ error: 'Add a brief return reason before continuing.' }, { status: 400 });
  if (items.length === 0 || items.length !== rawItems.length) return Response.json({ error: 'Select one or more whole-number quantities to return.' }, { status: 400 });
  if (new Set(items.map((item) => item.invoice_item_id)).size !== items.length) return Response.json({ error: 'Each invoice line may appear only once in a return.' }, { status: 400 });

  try {
    const { data, error } = await getDatabase().rpc('jde_create_sales_return', {
      p_company_id: companyId,
      p_invoice_id: invoiceId,
      p_customer_id: customerId,
      p_reason: reason,
      p_items: items,
    }).single();
    if (error) throw error;
    return Response.json(data, { status: 201 });
  } catch (error) {
    console.error('POST /api/sales (return) failed:', error);
    // A rule the database enforced on purpose is something the owner can act on, so it is
    // answered as a 4xx carrying the real sentence. Only genuine faults become a 500, which the
    // browser deliberately shows as "the ERP is temporarily unavailable".
    if (isBusinessRuleError(error)) {
      return Response.json({ error: errorMessage(error, 'This return could not be recorded.') }, { status: 422 });
    }
    return Response.json({ error: errorMessage(error, 'The sales return was not saved.') }, { status: 500 });
  }
}
