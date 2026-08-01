import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { TABLES, type TableName } from './schema';

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new Error('Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.');
    }
    client = createClient(url, serviceKey, { auth: { persistSession: false } });
  }
  return client;
}

function supaTable(table: TableName): string {
  return `jde_${table}`;
}

export function isKnownTable(name: string): name is TableName {
  return name in TABLES;
}

export function isCompanyScoped(table: TableName): boolean {
  return Boolean(TABLES[table].companyScoped);
}

export async function getActiveCompanyId(): Promise<string | undefined> {
  const { data, error } = await getClient()
    .from(supaTable('companies'))
    .select('id')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id;
}

export async function activateCompany(id: string): Promise<Record<string, unknown> | undefined> {
  const { error } = await getClient().rpc('jde_activate_company', { target_id: id });
  if (error) throw error;
  const { data, error: fetchError } = await getClient().from(supaTable('companies')).select('*').eq('id', id).maybeSingle();
  if (fetchError) throw fetchError;
  return (data as Record<string, unknown> | null) ?? undefined;
}

export async function listRows(table: TableName, companyId?: string): Promise<Array<Record<string, unknown>>> {
  let query = getClient().from(supaTable(table)).select('*');
  if (isCompanyScoped(table) && companyId) {
    query = query.eq('company_id', companyId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data as Array<Record<string, unknown>>) ?? [];
}

export async function insertRow(table: TableName, row: Record<string, unknown>): Promise<Record<string, unknown>> {
  const def = TABLES[table];
  const primaryKeyValue = row[def.primaryKey] ?? randomUUID();
  let fullRow: Record<string, unknown> = { ...row, [def.primaryKey]: primaryKeyValue };

  if (def.companyScoped && !fullRow.company_id) {
    fullRow = { ...fullRow, company_id: (await getActiveCompanyId()) ?? null };
  }

  const { data, error } = await getClient().from(supaTable(table)).insert(fullRow).select().single();
  if (error) throw error;
  return data as Record<string, unknown>;
}

export async function updateRow(table: TableName, id: string, patch: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
  const def = TABLES[table];
  const safePatch = { ...patch };
  delete safePatch[def.primaryKey];

  if (Object.keys(safePatch).length > 0) {
    const { error } = await getClient().from(supaTable(table)).update(safePatch).eq(def.primaryKey, id);
    if (error) throw error;
  }
  const { data, error: fetchError } = await getClient().from(supaTable(table)).select('*').eq(def.primaryKey, id).maybeSingle();
  if (fetchError) throw fetchError;
  return (data as Record<string, unknown> | null) ?? undefined;
}

export async function deleteRow(table: TableName, id: string): Promise<void> {
  const def = TABLES[table];
  const { error } = await getClient().from(supaTable(table)).delete().eq(def.primaryKey, id);
  if (error) throw error;
}

export type AdjustableTable = 'products' | 'customers' | 'suppliers';

const ADJUST_RPC: Record<AdjustableTable, { fn: string; idParam: string; deltaParam: string }> = {
  products: { fn: 'jde_adjust_product_stock', idParam: 'p_id', deltaParam: 'p_delta' },
  customers: { fn: 'jde_adjust_customer_balance', idParam: 'c_id', deltaParam: 'c_delta' },
  suppliers: { fn: 'jde_adjust_supplier_balance', idParam: 's_id', deltaParam: 's_delta' },
};

/**
 * Atomically adds `delta` to a product's current_stock / a customer's or supplier's balance,
 * via a database-side UPDATE ... SET col = col + delta. Safe under concurrent writes from
 * multiple computers, unlike reading the current value in JS and writing back the sum.
 */
export async function adjustRow(table: AdjustableTable, id: string, delta: number): Promise<Record<string, unknown>> {
  const rpc = ADJUST_RPC[table];
  const { data, error } = await getClient().rpc(rpc.fn, { [rpc.idParam]: id, [rpc.deltaParam]: delta }).single();
  if (error) throw error;
  return data as Record<string, unknown>;
}

/** Opens a new FIFO cost batch for a product. When adjustStock is true (purchases, manual
 *  stock increases) this also atomically bumps current_stock; pass false when current_stock
 *  was already set some other way (new product with opening stock, historical backfill) so
 *  it isn't double-counted. */
export async function addStockLayer(
  productId: string, qty: number, unitCost: number, sourcePoId: string | null, adjustStock: boolean
): Promise<Record<string, unknown>> {
  const { data, error } = await getClient()
    .rpc('jde_add_stock_layer', { p_product_id: productId, p_qty: qty, p_unit_cost: unitCost, p_source_po_id: sourcePoId, p_adjust_stock: adjustStock })
    .single();
  if (error) throw error;
  return data as Record<string, unknown>;
}

/** Decrements current_stock and draws `qty` from the oldest open FIFO batches first. Pass
 *  invoiceItemId to record exactly what was drawn from where (so it can be reversed later via
 *  restoreStockForInvoiceItem); pass null for one-off manual adjustments with nothing to reverse. */
export async function consumeStockFifo(
  productId: string, qty: number, invoiceItemId: string | null
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await getClient()
    .rpc('jde_consume_stock_fifo', { p_product_id: productId, p_qty: qty, p_invoice_item_id: invoiceItemId });
  if (error) throw error;
  return (data as Array<Record<string, unknown>>) ?? [];
}

/** Reverses a prior consumeStockFifo call for one invoice line: hands the quantity back to the
 *  exact batches it was drawn from, restores current_stock, and clears the consumption records. */
export async function restoreStockForInvoiceItem(invoiceItemId: string): Promise<number> {
  const { data, error } = await getClient()
    .rpc('jde_restore_stock_layers_for_invoice_item', { p_invoice_item_id: invoiceItemId })
    .single();
  if (error) throw error;
  return Number((data as { restored_qty: number }).restored_qty);
}

/** Corrects the cost of the batch a product's displayed cost/margin is currently reading from —
 *  for editing the Cost Price field on its own, with no stock quantity change (which is why
 *  addStockLayer/consumeStockFifo wouldn't otherwise touch it). Returns null if the product has
 *  no open batch to correct (nothing to do; the static cost_price field is already the source of
 *  truth in that case, and gets updated by the normal product PATCH regardless). */
export async function correctOldestLayerCost(productId: string, newCost: number): Promise<Record<string, unknown> | null> {
  const { data, error } = await getClient()
    .rpc('jde_correct_oldest_layer_cost', { p_product_id: productId, p_new_cost: newCost })
    .maybeSingle();
  if (error) throw error;
  return (data as Record<string, unknown> | null) ?? null;
}

export async function deleteCompany(id: string): Promise<{ error: string } | { ok: true }> {
  const companies = (await listRows('companies')) as Array<{ id: string; is_active: boolean }>;
  const target = companies.find((c) => c.id === id);
  if (!target) return { error: 'Company not found.' };
  if (companies.length <= 1) return { error: 'At least one company must remain.' };
  if (target.is_active) return { error: 'Set another company active before deleting this one.' };

  const { error } = await getClient().rpc('jde_delete_company', { target_id: id });
  if (error) throw error;
  return { ok: true };
}
