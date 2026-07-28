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
