import { dbErrorMessage, receivePurchaseStock } from '@/lib/db';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getCurrentUser } from '@/lib/auth/dal';

export const dynamic = 'force-dynamic';

type ReturnLine = { poItemId: string; qty: number };

function isReturnLine(value: unknown): value is ReturnLine {
  return typeof value === 'object'
    && value !== null
    && 'poItemId' in value
    && typeof value.poItemId === 'string'
    && value.poItemId.trim().length > 0
    && 'qty' in value
    && typeof value.qty === 'number'
    && Number.isFinite(value.qty)
    && value.qty > 0;
}

/**
 * Supplier returns need an owner-only, server-side service-role operation because a return
 * changes inventory and supplier payables. The database RPC is the sole writer: it verifies the
 * received PO, original line ownership, remaining source-PO FIFO quantity, and writes the
 * return audit rows before lowering stock/payable in the same transaction.
 */
async function recordPurchaseReturn(body: Record<string, unknown>) {
  const { companyId, poId, supplierId, note, lines } = body;
  if (typeof companyId !== 'string' || !companyId.trim()) return Response.json({ error: 'companyId is required.' }, { status: 400 });
  if (typeof poId !== 'string' || !poId.trim()) return Response.json({ error: 'poId is required.' }, { status: 400 });
  if (typeof supplierId !== 'string' || !supplierId.trim()) return Response.json({ error: 'supplierId is required.' }, { status: 400 });
  if (typeof note !== 'undefined' && (typeof note !== 'string' || note.length > 1000)) return Response.json({ error: 'Note must be 1,000 characters or fewer.' }, { status: 400 });
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 100) return Response.json({ error: 'Select between 1 and 100 return lines.' }, { status: 400 });
  if (!lines.every(isReturnLine)) return Response.json({ error: 'Every return line needs a purchase item and quantity greater than zero.' }, { status: 400 });
  if (new Set(lines.map((line) => line.poItemId)).size !== lines.length) return Response.json({ error: 'Each purchase item can appear only once in a return.' }, { status: 400 });

  // This is intentionally independent of proxy.ts: a service-role write endpoint must defend
  // itself in case its routing protection is ever changed.
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  if (user.role !== 'owner') return Response.json({ error: 'Only the owner can record supplier returns.' }, { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return Response.json({ error: 'Supplier returns are not configured on this deployment.' }, { status: 503 });

  try {
    const client = createServiceClient(url, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await client.rpc('jde_record_purchase_return', {
      p_company_id: companyId,
      p_po_id: poId,
      p_supplier_id: supplierId,
      p_lines: lines.map((line) => ({ po_item_id: line.poItemId, qty: line.qty })),
      p_note: typeof note === 'string' ? note.trim() : '',
    }).single();
    if (error) throw error;
    return Response.json(data, { status: 201 });
  } catch (error) {
    console.error('POST /api/purchases/receive (return) failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Could not record this supplier return.') }, { status: 500 });
  }
}

/** Provides the UI with the database-calculated quantity still eligible for a supplier return.
 * It uses the same source-PO FIFO rule as the mutation, so the client cannot over-promise what
 * it may send back when some of that batch has already been sold or returned. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('returnCompanyId');
  const poId = searchParams.get('returnPoId');
  if (!companyId || !poId) return Response.json({ error: 'returnCompanyId and returnPoId are required.' }, { status: 400 });

  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  if (user.role !== 'owner') return Response.json({ error: 'Only the owner can view supplier return availability.' }, { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return Response.json({ error: 'Supplier returns are not configured on this deployment.' }, { status: 503 });

  try {
    const client = createServiceClient(url, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await client.rpc('jde_get_returnable_purchase_items', {
      p_company_id: companyId,
      p_po_id: poId,
    });
    if (error) throw error;
    return Response.json(data ?? []);
  } catch (error) {
    console.error('GET /api/purchases/receive (return availability) failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Could not load supplier return availability.') }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await request.json();
  if (body?.action === 'return' && typeof body === 'object') {
    return recordPurchaseReturn(body as Record<string, unknown>);
  }
  const { companyId, poId, supplierName, receivedAt, items } = body ?? {};

  if (typeof companyId !== 'string' || !companyId) {
    return Response.json({ error: 'companyId is required' }, { status: 400 });
  }
  if (typeof poId !== 'string' || !poId) {
    return Response.json({ error: 'poId is required' }, { status: 400 });
  }
  if (!Array.isArray(items)) {
    return Response.json({ error: 'items must be an array' }, { status: 400 });
  }

  try {
    const po = await receivePurchaseStock({
      companyId,
      poId,
      supplierName: String(supplierName ?? ''),
      receivedAt: String(receivedAt ?? ''),
      items,
    });
    return Response.json(po);
  } catch (error) {
    console.error('POST /api/purchases/receive failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Failed to mark this purchase received.') }, { status: 500 });
  }
}
