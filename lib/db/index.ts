import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { TABLES, type TableName } from './schema';

/** Supabase/PostgREST errors are plain {message, details, hint, code} objects, not real Error
 *  instances — an `error instanceof Error` check silently swallows the real message. Duck-type
 *  instead so API routes can always return a real message to the client rather than a generic
 *  one (or, if uncaught, a response with no body at all — which crashes callers on `res.json()`
 *  with a raw "Unexpected end of JSON input" instead of anything actionable). */
export function dbErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return fallback;
}

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

/** Which single company's published catalog is shown on the public /catalog pages —
 *  deliberately separate from "active company" (which is which company an admin is
 *  currently working in, and can change while someone works on unrelated data), so
 *  switching companies in the ERP UI never changes what the public site shows. */
export async function setStorefrontCompany(id: string): Promise<Record<string, unknown> | undefined> {
  const { error } = await getClient().rpc('jde_set_storefront_company', { target_id: id });
  if (error) throw error;
  const { data, error: fetchError } = await getClient().from(supaTable('companies')).select('*').eq('id', id).maybeSingle();
  if (fetchError) throw fetchError;
  return (data as Record<string, unknown> | null) ?? undefined;
}

/** Server-only: the company currently flagged as the public storefront, or undefined
 *  if none is (in which case callers must show an honest empty catalog — never fall
 *  back to showing every company's published rows mixed together). */
export async function getStorefrontCompanyId(): Promise<string | undefined> {
  const { data, error } = await getClient()
    .from(supaTable('companies'))
    .select('id')
    .eq('is_storefront', true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id;
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

/** Columns safe to show a public website visitor — never cost price, stock, supplier data,
 *  internal notes, or any draft/review-workflow field, regardless of what gets added to
 *  jde_catalog_products later for the admin workflow. */
const PUBLIC_CATALOG_COLUMNS =
  'id, title, description, category, brand, part_number, oem_number, compatibility, price, availability, image_url, published_at';

/** Server-only: every published catalog row for the storefront company, safe columns only. Used
 *  exclusively by the public /catalog pages — never by the admin UI, which reads catalog_products
 *  via the generic /api/local table route instead (and so sees every column, as an authenticated
 *  admin should). Scoped to whichever company is flagged is_storefront: this app's Supabase
 *  project holds more than one company's data, and without this filter every company's published
 *  listings would show mixed together on the one public, JD-Enterprises-branded site. No company
 *  flagged → an honest empty catalog, never a fallback to showing everything. */
export async function listPublishedCatalogProducts(): Promise<Array<Record<string, unknown>>> {
  const companyId = await getStorefrontCompanyId();
  if (!companyId) return [];
  const { data, error } = await getClient()
    .from(supaTable('catalog_products'))
    .select(PUBLIC_CATALOG_COLUMNS)
    .eq('publication_status', 'published')
    .eq('company_id', companyId)
    .order('published_at', { ascending: false });
  if (error) throw error;
  return (data as Array<Record<string, unknown>>) ?? [];
}

/** Server-only: a single published catalog row, safe columns only, plus company_id — the detail
 *  page (a Server Component) uses company_id to look up that company's quote-request contact
 *  info via getCompanyPublicContact, but never renders the id itself into the page. Scoped to the
 *  storefront company for the same reason as listPublishedCatalogProducts — a product id alone
 *  isn't enough to guarantee it belongs to the company whose site is being browsed. */
export async function getPublishedCatalogProduct(id: string): Promise<Record<string, unknown> | undefined> {
  const companyId = await getStorefrontCompanyId();
  if (!companyId) return undefined;
  const { data, error } = await getClient()
    .from(supaTable('catalog_products'))
    .select(`${PUBLIC_CATALOG_COLUMNS}, company_id`)
    .eq('id', id)
    .eq('publication_status', 'published')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw error;
  return (data as Record<string, unknown> | null) ?? undefined;
}

export type CatalogLeadInput = {
  catalogProductId: string;
  partTitle: string;
  partNumber: string;
  customerName: string;
  customerPhone: string;
  quantity?: number | null;
  machineModel?: string | null;
  message?: string | null;
};

/** Server-only, insert-only: records a Request-a-Quote submission from the public catalog.
 *  Deliberately not the generic /api/local admin CRUD layer (that route has no auth at all, so
 *  routing public writes through it would let anyone list every company's leads by guessing a
 *  company_id — a strictly worse information-disclosure surface than exists today). company_id
 *  always comes from the storefront flag, never from the caller, since an anonymous request body
 *  is not a trustworthy source for which company's data it should land under. */
export async function insertCatalogLead(input: CatalogLeadInput): Promise<void> {
  const companyId = await getStorefrontCompanyId();
  if (!companyId) throw new Error('No public catalog is configured right now.');
  const { error } = await getClient().from(supaTable('catalog_leads')).insert({
    company_id: companyId,
    catalog_product_id: input.catalogProductId,
    part_title: input.partTitle,
    part_number: input.partNumber,
    customer_name: input.customerName,
    customer_phone: input.customerPhone,
    quantity: input.quantity ?? null,
    machine_model: input.machineModel ?? null,
    message: input.message ?? null,
    source: 'catalog_website',
    status: 'new',
  });
  if (error) throw error;
}

export type CatalogEventInput = {
  eventType: 'search' | 'view';
  catalogProductId?: string | null;
  query?: string | null;
  zeroResults?: boolean | null;
};

/** Server-only, insert-only, fire-and-forget from the caller's perspective: basic catalog usage
 *  analytics (search terms incl. zero-result, product views). Same "never trust a client-supplied
 *  company_id" rule as insertCatalogLead. RFQ counts are derived from catalog_leads directly
 *  rather than logged here too, so there's one write and one source of truth per customer action. */
export async function logCatalogEvent(input: CatalogEventInput): Promise<void> {
  const companyId = await getStorefrontCompanyId();
  if (!companyId) return;
  const { error } = await getClient().from(supaTable('catalog_events')).insert({
    company_id: companyId,
    event_type: input.eventType,
    catalog_product_id: input.catalogProductId ?? null,
    query: input.query ?? null,
    zero_results: input.zeroResults ?? null,
  });
  if (error) throw error;
}

/** Server-only: the minimal public contact info for one company, for the website's "Request a
 *  Quote" link. Returns undefined fields rather than throwing when a company has none set. */
export async function getCompanyPublicContact(companyId: string): Promise<{ contact_email: string | null; contact_phone: string | null } | undefined> {
  const { data, error } = await getClient()
    .from(supaTable('companies'))
    .select('contact_email, contact_phone')
    .eq('id', companyId)
    .maybeSingle();
  if (error) throw error;
  return (data as { contact_email: string | null; contact_phone: string | null } | null) ?? undefined;
}

const CATALOG_IMAGE_BUCKET = 'jde-catalog-images';
const CATALOG_IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function isSupportedCatalogImageType(mimeType: string): boolean {
  return mimeType in CATALOG_IMAGE_EXTENSIONS;
}

/** Uploads/replaces the one approved image for a catalog row (service-role only — the bucket
 *  has no client-writable storage.objects policy, matching every other write path in this app)
 *  and returns its public URL. Path is keyed by catalogId only, so re-uploading always replaces
 *  the current image; switching image format on a re-upload leaves the old-extension file
 *  orphaned in storage (harmless — not linked from anywhere once image_url is overwritten). */
export async function uploadCatalogImage(catalogId: string, base64: string, mimeType: string): Promise<string> {
  const ext = CATALOG_IMAGE_EXTENSIONS[mimeType];
  if (!ext) throw new Error('Unsupported image type — please use JPEG, PNG, or WebP.');
  const path = `${catalogId}.${ext}`;
  const buffer = Buffer.from(base64, 'base64');
  const { error } = await getClient()
    .storage.from(CATALOG_IMAGE_BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: true });
  if (error) throw error;
  const { data } = getClient().storage.from(CATALOG_IMAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
