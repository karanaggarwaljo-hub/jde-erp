import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { TABLES, type TableName } from './schema';

export type { TableName };

/** Supabase/PostgREST errors are plain {message, details, hint, code} objects, not real Error
 *  instances — an `error instanceof Error` check silently swallows the real message. Duck-type
 *  instead so API routes can always return a real message to the client rather than a generic
 *  one (or, if uncaught, a response with no body at all — which crashes callers on `res.json()`
 *  with a raw "Unexpected end of JSON input" instead of anything actionable). */
/** True when Postgres deliberately rejected the operation with `raise exception` — a business
 *  rule the owner can act on ("Return quantity exceeds the remaining quantity for X"), not a
 *  fault. SQLSTATE P0001 is the code Postgres assigns those, which is exactly what separates a
 *  rule from a genuine failure: routes can answer 422 with the real sentence instead of a 500,
 *  which the browser deliberately replaces with "the ERP is temporarily unavailable". */
export function isBusinessRuleError(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'P0001'
  );
}

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

/** Server-only existence check; never returns another company's record. */
export async function companyExists(id: string): Promise<boolean> {
  const { data, error } = await getClient().from(supaTable('companies')).select('id').eq('id', id).maybeSingle();
  if (error) throw error;
  return data !== null;
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

/**
 * Bulk import uses one PostgREST insert instead of one browser/API/auth/database round trip per
 * row. This is intentionally server-side only; callers still go through a protected API route.
 */
export async function insertRows(table: TableName, rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return [];
  const def = TABLES[table];
  const fallbackCompanyId = def.companyScoped && rows.some((row) => !row.company_id)
    ? await getActiveCompanyId()
    : undefined;
  const fullRows = rows.map((row) => ({
    ...row,
    [def.primaryKey]: row[def.primaryKey] ?? randomUUID(),
    ...(def.companyScoped && !row.company_id ? { company_id: fallbackCompanyId ?? null } : {}),
  }));
  const { data, error } = await getClient().from(supaTable(table)).insert(fullRows).select();
  if (error) throw error;
  return (data as Record<string, unknown>[]) ?? [];
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

/** Which company a specific row belongs to — the one thing a client-supplied id can't be trusted
 *  to say about itself. Used to check a caller's own company against a row they're trying to
 *  read/write by id, for the many endpoints (generic table PATCH/DELETE, stock adjust, FIFO)
 *  that take only a row id and never carried a company_id of their own to check against. */
export async function getRowCompanyId(table: TableName, id: string): Promise<string | undefined> {
  const def = TABLES[table];
  if (!def.companyScoped) return undefined;
  const { data, error } = await getClient().from(supaTable(table)).select('company_id').eq(def.primaryKey, id).maybeSingle();
  if (error) throw error;
  return (data as { company_id: string } | null)?.company_id ?? undefined;
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

export type SalesInvoiceItemInput = {
  product_id: string | null;
  part_number: string;
  name: string;
  qty: number;
  unit_price: number;
  line_total: number;
};

export type SaveSalesInvoiceInput = {
  companyId: string;
  /** Only meaningful (and required) when isEdit is true — a create ignores this and the database
   *  generates the real id itself, since a client-guessed id can't safely account for every other
   *  company's existing invoices (the id column is globally unique, not scoped per company). */
  invoiceId: string | null;
  isEdit: boolean;
  customerLabel: string;
  oldCustomerId: string | null;
  newCustomerId: string | null;
  oldOutstanding: number;
  newOutstanding: number;
  date: string;
  items: SalesInvoiceItemInput[];
  total: number;
  paid: number;
  status: string;
  mode: string;
  discountPercent: number;
  discountAmount: number;
};

/** Atomically creates or edits a sales invoice — header, line items, FIFO stock
 *  consumption/restoration, and customer balance — as one database transaction (jde_save_sales_invoice),
 *  instead of the 6-10 separate browser-initiated calls the Sales page used to make, which could leave
 *  stock/balances/the invoice itself out of sync if one step failed partway through. */
export async function saveSalesInvoice(input: SaveSalesInvoiceInput): Promise<Record<string, unknown>> {
  const { data, error } = await getClient()
    .rpc('jde_save_sales_invoice', {
      p_company_id: input.companyId,
      p_invoice_id: input.invoiceId,
      p_is_edit: input.isEdit,
      p_customer_label: input.customerLabel,
      p_old_customer_id: input.oldCustomerId,
      p_new_customer_id: input.newCustomerId,
      p_old_outstanding: input.oldOutstanding,
      p_new_outstanding: input.newOutstanding,
      p_date: input.date,
      p_items: input.items,
      p_total: input.total,
      p_paid: input.paid,
      p_status: input.status,
      p_mode: input.mode,
      p_discount_percent: input.discountPercent,
      p_discount_amount: input.discountAmount,
    })
    .single();
  if (error) throw error;
  return data as Record<string, unknown>;
}

/** Atomically deletes a sales invoice — restores FIFO stock for every line item, reverses the
 *  customer balance, then removes the items and the invoice — as one database transaction.
 *  jde_delete_sales_invoice itself refuses this once a payment has been recorded against the
 *  invoice (see scripts/customer-payments.sql) — delete/edit that payment first. Deliberately
 *  takes no `outstanding` amount: the function computes the real due amount from the invoice's
 *  own stored total/paid itself, rather than trusting a number a caller supplies — a client-
 *  controlled figure applied to a customer's balance was the actual, wrong prior design. */
export async function deleteSalesInvoice(companyId: string, invoiceId: string, customerId: string | null): Promise<void> {
  const { error } = await getClient().rpc('jde_delete_sales_invoice', {
    p_company_id: companyId,
    p_invoice_id: invoiceId,
    p_customer_id: customerId,
  });
  if (error) throw error;
}

export type PaymentAllocationInput = { invoiceId: string; amount: number };

export type ReceiveCustomerPaymentInput = {
  companyId: string;
  customerId: string;
  date: string;
  amount: number;
  note: string;
  /** Which invoices this payment settles, and how much of it goes to each. Must sum to exactly
   *  `amount` — jde_receive_customer_payment enforces this, so every rupee entered is always
   *  accounted for against a real invoice, never left floating as an unexplained credit. */
  allocations: PaymentAllocationInput[];
};

/** Atomically records one payment against a customer and applies it across the invoices the
 *  owner chose — the payment row, its per-invoice allocations, each invoice's paid/status, and
 *  the customer's running balance all land together (jde_receive_customer_payment), instead of
 *  hand-editing each invoice's paid amount separately with no record that the payment itself
 *  ever happened. This is what lets a customer who bought across several days on credit pay the
 *  running total in one visit, with a receipt to show for it. */
export async function receiveCustomerPayment(input: ReceiveCustomerPaymentInput): Promise<{ payment_id: string; applied_total: number }> {
  const { data, error } = await getClient()
    .rpc('jde_receive_customer_payment', {
      p_company_id: input.companyId,
      p_customer_id: input.customerId,
      p_date: input.date,
      p_amount: input.amount,
      p_note: input.note,
      p_allocations: input.allocations.map((line) => ({ invoice_id: line.invoiceId, amount: line.amount })),
    })
    .single();
  if (error) throw error;
  return data as { payment_id: string; applied_total: number };
}

export type WriteOffInvoiceBalanceInput = {
  companyId: string;
  invoiceId: string;
  /** How much of what is still owing to forgive. The database refuses anything larger. */
  amount: number;
  reason: string;
  /** Blank means today in India — the database fills it in rather than trusting a browser clock. */
  date: string;
};

export type WriteOffResult = {
  write_off_id: string;
  written_off: number;
  remaining_due: number;
  customer_balance: number | null;
};

/** Atomically closes part or all of what a customer still owes on an invoice they settled by
 *  paying less than it was for. The invoice keeps the total it was issued for and its `paid`
 *  amount is left alone — only real money belongs there — while the shortfall is recorded in its
 *  own column, written to an audit row with its reason, and taken off the customer's balance
 *  (jde_write_off_invoice_balance). Splitting it out this way is what stops forgiven debt from
 *  being counted as cash received in every report and digest that reads `paid`. */
export async function writeOffInvoiceBalance(input: WriteOffInvoiceBalanceInput): Promise<WriteOffResult> {
  const { data, error } = await getClient()
    .rpc('jde_write_off_invoice_balance', {
      p_company_id: input.companyId,
      p_invoice_id: input.invoiceId,
      p_amount: input.amount,
      p_reason: input.reason,
      p_date: input.date,
    })
    .single();
  if (error) throw error;
  return data as WriteOffResult;
}

/** Atomically reverses a recorded payment — puts every invoice it was applied to back to its
 *  prior paid amount and status, corrects the customer's balance by the same total, then removes
 *  the payment and its allocations. Used when a payment was entered wrong, not for a genuine
 *  refund (which is a business decision belonging to a real transaction, not an undo button). */
export async function deleteCustomerPayment(companyId: string, paymentId: string): Promise<void> {
  const { error } = await getClient().rpc('jde_delete_customer_payment', {
    p_company_id: companyId,
    p_payment_id: paymentId,
  });
  if (error) throw error;
}

export type PurchaseItemInput = {
  product_id: string | null;
  part_number: string;
  name: string;
  qty: number;
  unit_cost: number;
  line_total: number;
};

export type SavePurchaseInput = {
  companyId: string;
  supplierId: string | null;
  supplierName: string;
  date: string;
  receivedAt: string;
  items: PurchaseItemInput[];
  total: number;
  paid: number;
  status: string;
  /** SHA-256 hash of the source invoice file, when this purchase came from a scanned/imported
   *  file — null for manual entry. jde_save_purchase rejects a second purchase with the same
   *  (company, hash) pair, so the exact same invoice file can never be recorded twice. */
  sourceFileHash?: string | null;
};

/** Atomically records a new purchase — PO header, line items, GRN, FIFO stock layers, and
 *  supplier balance — as one database transaction (jde_save_purchase), instead of the 5-9+
 *  separate browser-initiated calls the Purchases page used to make. The PO/GRN ids are generated
 *  inside the function itself (from the true max across every company, not just the caller's
 *  possibly-stale/company-scoped view) — the caller reads the real id off the returned row rather
 *  than guessing one, since the id column is globally unique across all companies. */
export async function savePurchase(input: SavePurchaseInput): Promise<Record<string, unknown>> {
  const { data, error } = await getClient()
    .rpc('jde_save_purchase', {
      p_company_id: input.companyId,
      p_supplier_id: input.supplierId,
      p_supplier_name: input.supplierName,
      p_date: input.date,
      p_received_at: input.receivedAt,
      p_items: input.items,
      p_total: input.total,
      p_paid: input.paid,
      p_status: input.status,
      p_source_file_hash: input.sourceFileHash ?? null,
    })
    .single();
  if (error) throw error;
  return data as Record<string, unknown>;
}

export type RecordPurchasePaymentInput = {
  companyId: string;
  poId: string;
  amount: number;
};

/** Atomically records a payment against one purchase order: the amount paid on the order and the
 *  supplier's outstanding payable move together inside jde_record_purchase_payment, so they can
 *  never disagree. The database is the sole judge of how much is still owing — it locks the order
 *  and rejects a payment larger than the balance, an amount of zero or less, and an order that is
 *  already settled, rather than trusting whatever the browser calculated. */
export async function recordPurchasePayment(input: RecordPurchasePaymentInput): Promise<Record<string, unknown>> {
  const { data, error } = await getClient()
    .rpc('jde_record_purchase_payment', {
      p_company_id: input.companyId,
      p_po_id: input.poId,
      p_amount: input.amount,
    })
    .single();
  if (error) throw error;
  return data as Record<string, unknown>;
}

/** Server-only: the id of the purchase already recorded from this exact invoice file, if any —
 *  used to reject a re-scan of a file that's already been recorded before spending an AI call on
 *  it, not just at final save time. Returns undefined when this file hasn't been recorded yet. */
export async function findPurchaseByFileHash(companyId: string, fileHash: string): Promise<string | undefined> {
  const { data, error } = await getClient()
    .from(supaTable('purchase_orders'))
    .select('id')
    .eq('company_id', companyId)
    .eq('source_file_hash', fileHash)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id;
}

export type ReceivePurchaseStockInput = {
  companyId: string;
  poId: string;
  supplierName: string;
  receivedAt: string;
  items: Array<{ product_id: string | null; qty: number; unit_cost: number }>;
};

/** Atomically marks a pre-existing pending purchase order received — GRN, FIFO stock layers, and
 *  status — as one database transaction. For purchases created through this app's own "Record
 *  Purchase" / file-import flows (which use savePurchase above and are already 'received'
 *  immediately); this path exists for older/externally-created pending POs. The GRN id is
 *  generated inside the function itself, same reasoning as savePurchase above. */
export async function receivePurchaseStock(input: ReceivePurchaseStockInput): Promise<Record<string, unknown>> {
  const { data, error } = await getClient()
    .rpc('jde_receive_purchase_stock', {
      p_company_id: input.companyId,
      p_po_id: input.poId,
      p_supplier_name: input.supplierName,
      p_received_at: input.receivedAt,
      p_items: input.items,
    })
    .single();
  if (error) throw error;
  return data as Record<string, unknown>;
}

export type CreateExpenseInput = {
  companyId: string;
  category: string;
  description: string;
  amount: number;
  date: string;
  paidBy: string;
  mode: string;
};

/** Records a new expense with a server-generated id (jde_create_expense) — same reasoning as
 *  savePurchase/saveSalesInvoice above: the id is globally unique across every company, so it's
 *  generated from the true full-table state inside the function, not guessed client-side from
 *  whichever company's rows happen to already be loaded in the browser. */
export async function createExpense(input: CreateExpenseInput): Promise<Record<string, unknown>> {
  const { data, error } = await getClient()
    .rpc('jde_create_expense', {
      p_company_id: input.companyId,
      p_category: input.category,
      p_description: input.description,
      p_amount: input.amount,
      p_date: input.date,
      p_paid_by: input.paidBy,
      p_mode: input.mode,
    })
    .single();
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

export type StaffUserRecord = { email: string; company_id: string | null; name: string | null; role: string; status: string };

/** Server-only, looked up by email alone — jde_users' primary key IS the email column (see
 *  lib/db/schema.ts), not an (email, company_id) composite, so this must never filter by the
 *  currently-active company (an unrelated, shared, mutable global — see activateCompany above).
 *  This is the authorization half of login: a valid Supabase Auth identity is necessary but not
 *  sufficient to use this ERP — it must also have a row here with status 'active'. */
export async function getUserRecord(email: string): Promise<StaffUserRecord | undefined> {
  const { data, error } = await getClient()
    .from(supaTable('users'))
    .select('*')
    .eq('email', email)
    .maybeSingle();
  if (error) throw error;
  return (data as StaffUserRecord | null) ?? undefined;
}

/** Sends a real Supabase Auth invite email (service-role/admin action, so it lives here
 *  alongside this file's one Supabase client rather than a separate ad hoc one) so a new
 *  teammate can set their own password. The jde_users row itself (status: 'invited') is
 *  created separately by the caller once this succeeds — matching the existing Settings
 *  "Invite User" flow, just now backed by a real credential instead of a bare row. */
export async function inviteStaffUser(email: string, name: string, redirectTo: string): Promise<void> {
  const { error } = await getClient().auth.admin.inviteUserByEmail(email, {
    data: { full_name: name },
    redirectTo,
  });
  if (error) throw error;
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

/* ---------------------------------------------------------------------------------------------
 * AI result cache
 *
 * Deliberately NOT registered in lib/db/schema.ts's TABLES map. That map drives the generic
 * /api/local/[table] CRUD routes the browser talks to; this table is server-internal bookkeeping
 * and has no business being reachable from a page.
 * ------------------------------------------------------------------------------------------- */

export type AiCacheRow = {
  payload: unknown;
  fingerprint: string;
  generated_at: string;
  day_ist: string;
  runs_on_day: number;
};

/** The business day in Asia/Kolkata, as YYYY-MM-DD. The daily allowance resets on the owner's
 *  own day, not on UTC midnight — which in India falls at 5:30am, mid-morning. */
export function businessDayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export async function readAiCache(companyId: string, feature: string, variant = ''): Promise<AiCacheRow | undefined> {
  const { data, error } = await getClient()
    .from('jde_ai_cache')
    .select('payload, fingerprint, generated_at, day_ist, runs_on_day')
    .eq('company_id', companyId)
    .eq('feature', feature)
    .eq('variant', variant)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AiCacheRow | null) ?? undefined;
}

/** Records a freshly generated result and counts it against today's allowance. Called only after
 *  a generation actually succeeded, so a failed or unreachable AI never burns an attempt. */
export async function writeAiCache(
  companyId: string,
  feature: string,
  variant: string,
  fingerprint: string,
  payload: unknown
): Promise<AiCacheRow> {
  const today = businessDayIst();
  const existing = await readAiCache(companyId, feature, variant);
  const runsOnDay = existing && existing.day_ist === today ? existing.runs_on_day + 1 : 1;

  const { data, error } = await getClient()
    .from('jde_ai_cache')
    .upsert(
      {
        company_id: companyId,
        feature,
        variant,
        fingerprint,
        payload,
        generated_at: new Date().toISOString(),
        day_ist: today,
        runs_on_day: runsOnDay,
      },
      { onConflict: 'company_id,feature,variant' }
    )
    .select('payload, fingerprint, generated_at, day_ist, runs_on_day')
    .single();
  if (error) throw new Error(error.message);
  return data as AiCacheRow;
}
