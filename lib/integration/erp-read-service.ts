import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Decimal from 'decimal.js';
import {
  ErpIntegrationError,
  isWithinRange,
  sourceUri,
  timestamp,
  type ErpIntegrationEnvironment,
  type ErpIntegrationQuery,
} from './erp-contract';

const MAX_ROWS = 5_000;
const BATCH_SIZE = 100;

type InventoryBalance = {
  productId: string;
  warehouseId: string;
  onHand: string;
  reserved: string;
  available: string;
  unitOfMeasure: string;
  asOf: string;
  sourceUri: string;
};

type InventoryMovement = {
  id: string;
  productId: string;
  warehouseId: string;
  direction: 'in' | 'out' | 'adjustment';
  quantity: string;
  occurredAt: string;
  reference: string | null;
  sourceUri: string;
};

type PurchaseOrder = {
  id: string;
  supplierId: string;
  productId: string;
  warehouseId: string;
  orderedQuantity: string;
  receivedQuantity: string;
  status: 'draft' | 'approved' | 'partially_received' | 'received' | 'cancelled';
  expectedAt: string | null;
  sourceUri: string;
};

type ProductRow = { id: string; current_stock: string | number };
type StockLayerRow = {
  id: string;
  qty_original: string | number;
  qty_remaining?: string | number;
  source_po_id: string | null;
  created_at: string;
};
type HeaderRow = { id: string; date?: string; created_at?: string };
type InvoiceItemRow = { id: string; invoice_id: string; qty: string | number };
type ReturnItemRow = { id: string; qty: string | number; parent_id: string };
type PurchaseItemRow = { id: string; po_id: string; qty: string | number };
type PurchaseHeaderRow = { id: string; supplier: string; date: string; expected: string | null; status: string };
type SupplierRow = { id: string; name: string };

let serviceClient: SupabaseClient | null = null;

export async function getInventoryBalance(
  query: ErpIntegrationQuery,
  environment: ErpIntegrationEnvironment = process.env,
): Promise<InventoryBalance> {
  const client = getServiceClient(environment);
  const [productResult, layerResult] = await Promise.all([
    client
      .from('jde_products')
      .select('id,current_stock')
      .eq('company_id', query.organizationId)
      .eq('id', query.productId)
      .maybeSingle(),
    client
      .from('jde_stock_layers')
      .select('qty_remaining')
      .eq('company_id', query.organizationId)
      .eq('product_id', query.productId)
      .limit(MAX_ROWS + 1),
  ]);
  const product = resultData<ProductRow | null>(productResult, 'inventory product');
  const layers = bounded(resultData<Array<{ qty_remaining: string | number }>>(layerResult, 'FIFO stock layers'));
  if (!product) throw new ErpIntegrationError(404, 'Product not found in the requested company.');

  const recorded = decimal(product.current_stock, 'product current stock');
  const audited = sum(layers.map((layer) => layer.qty_remaining), 'FIFO stock balance');
  if (!recorded.equals(audited)) {
    throw new ErpIntegrationError(409, 'Product stock is out of sync with its FIFO audit ledger.');
  }
  const onHand = audited.toFixed();
  return {
    productId: product.id,
    warehouseId: query.warehouseId,
    onHand,
    reserved: '0',
    available: onHand,
    unitOfMeasure: query.unitOfMeasure,
    asOf: new Date().toISOString(),
    sourceUri: sourceUri('companies', query.organizationId, 'products', query.productId, 'fifo-balance'),
  };
}

export async function listInventoryMovements(
  query: ErpIntegrationQuery,
  environment: ErpIntegrationEnvironment = process.env,
): Promise<InventoryMovement[]> {
  const client = getServiceClient(environment);
  await requireProduct(client, query);
  const fromDate = query.from.toISOString().slice(0, 10);
  const toDate = query.to.toISOString().slice(0, 10);

  const [layersResult, invoicesResult, salesReturnsResult, purchaseReturnsResult] = await Promise.all([
    client
      .from('jde_stock_layers')
      .select('id,qty_original,source_po_id,created_at')
      .eq('company_id', query.organizationId)
      .eq('product_id', query.productId)
      .gte('created_at', query.from.toISOString())
      .lte('created_at', query.to.toISOString())
      .order('created_at', { ascending: true })
      .limit(MAX_ROWS + 1),
    client
      .from('jde_invoices')
      .select('id,date')
      .eq('company_id', query.organizationId)
      .gte('date', fromDate)
      .lte('date', toDate)
      .limit(MAX_ROWS + 1),
    client
      .from('jde_sales_returns')
      .select('id,created_at')
      .eq('company_id', query.organizationId)
      .gte('created_at', query.from.toISOString())
      .lte('created_at', query.to.toISOString())
      .limit(MAX_ROWS + 1),
    client
      .from('jde_purchase_returns')
      .select('id,created_at')
      .eq('company_id', query.organizationId)
      .gte('created_at', query.from.toISOString())
      .lte('created_at', query.to.toISOString())
      .limit(MAX_ROWS + 1),
  ]);

  const layers = bounded(resultData<StockLayerRow[]>(layersResult, 'stock receipt ledger'));
  const invoices = bounded(resultData<HeaderRow[]>(invoicesResult, 'sales invoice headers'));
  const salesReturns = bounded(resultData<HeaderRow[]>(salesReturnsResult, 'sales return headers'));
  const purchaseReturns = bounded(resultData<HeaderRow[]>(purchaseReturnsResult, 'purchase return headers'));

  const [invoiceItems, salesReturnItems, purchaseReturnItems] = await Promise.all([
    fetchInvoiceItems(client, query, invoices.map((row) => row.id)),
    fetchReturnItems(client, 'jde_sales_return_items', 'sales_return_id', query, salesReturns.map((row) => row.id)),
    fetchReturnItems(client, 'jde_purchase_return_items', 'purchase_return_id', query, purchaseReturns.map((row) => row.id)),
  ]);
  const invoiceById = new Map(invoices.map((row) => [row.id, row]));
  const salesReturnById = new Map(salesReturns.map((row) => [row.id, row]));
  const purchaseReturnById = new Map(purchaseReturns.map((row) => [row.id, row]));

  const movements: InventoryMovement[] = layers.map((layer) => ({
    id: `${layer.source_po_id ? 'receipt' : 'manual-increase'}:${layer.id}`,
    productId: query.productId,
    warehouseId: query.warehouseId,
    direction: layer.source_po_id ? 'in' : 'adjustment',
    quantity: decimal(layer.qty_original, 'stock layer quantity').toFixed(),
    occurredAt: timestamp(layer.created_at, 'stock layer timestamp'),
    reference: layer.source_po_id,
    sourceUri: sourceUri('companies', query.organizationId, 'stock-layers', layer.id),
  }));

  for (const item of invoiceItems) {
    const invoice = invoiceById.get(item.invoice_id);
    if (!invoice?.date) continue;
    const occurredAt = timestamp(invoice.date, 'invoice date');
    if (!isWithinRange(occurredAt, query.from, query.to)) continue;
    movements.push({
      id: `sale:${item.id}`,
      productId: query.productId,
      warehouseId: query.warehouseId,
      direction: 'out',
      quantity: decimal(item.qty, 'invoice item quantity').toFixed(),
      occurredAt,
      reference: item.invoice_id,
      sourceUri: sourceUri('companies', query.organizationId, 'invoice-items', item.id),
    });
  }
  appendReturnMovements(movements, salesReturnItems, salesReturnById, query, 'sales-return', 1);
  appendReturnMovements(movements, purchaseReturnItems, purchaseReturnById, query, 'purchase-return', -1);

  if (movements.length > MAX_ROWS) throw tooManyRows();
  return movements.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
}

export async function listPurchaseOrders(
  query: ErpIntegrationQuery,
  environment: ErpIntegrationEnvironment = process.env,
): Promise<PurchaseOrder[]> {
  const client = getServiceClient(environment);
  await requireProduct(client, query);
  const itemResult = await client
    .from('jde_po_items')
    .select('id,po_id,qty')
    .eq('company_id', query.organizationId)
    .eq('product_id', query.productId)
    .limit(MAX_ROWS + 1);
  const items = bounded(resultData<PurchaseItemRow[]>(itemResult, 'purchase order items'));
  if (items.length === 0) return [];

  const purchaseOrderIds = [...new Set(items.map((item) => item.po_id))];
  const [headers, layers, suppliers] = await Promise.all([
    fetchByIds<PurchaseHeaderRow>(client, 'jde_purchase_orders', 'id,supplier,date,expected,status', 'id', purchaseOrderIds),
    fetchByIds<StockLayerRow>(
      client,
      'jde_stock_layers',
      'id,qty_original,source_po_id,created_at',
      'source_po_id',
      purchaseOrderIds,
      (queryBuilder) => queryBuilder.eq('company_id', query.organizationId).eq('product_id', query.productId),
    ),
    fetchSuppliers(client, query.organizationId),
  ]);
  const headerById = new Map(headers.map((header) => [header.id, header]));
  const orderedByPurchaseOrder = groupQuantities(items, (item) => item.po_id, (item) => item.qty);
  const receivedByPurchaseOrder = groupQuantities(
    layers.filter((layer) => layer.source_po_id !== null),
    (layer) => layer.source_po_id as string,
    (layer) => layer.qty_original,
  );
  const supplierIds = supplierIndex(suppliers);

  const orders: PurchaseOrder[] = [];
  for (const purchaseOrderId of purchaseOrderIds) {
    const header = headerById.get(purchaseOrderId);
    if (!header) throw new ErpIntegrationError(409, `Purchase order ${purchaseOrderId} has items but no header.`);
    const status = mapPurchaseOrderStatus(header.status);
    const orderDate = timestamp(header.date, 'purchase order date');
    const expectedAt = header.expected ? timestamp(header.expected, 'purchase order expected date') : null;
    const open = status === 'approved' || status === 'partially_received';
    if (!open && !isWithinRange(orderDate, query.from, query.to)) continue;

    const ordered = orderedByPurchaseOrder.get(purchaseOrderId) ?? new Decimal(0);
    const received = receivedByPurchaseOrder.get(purchaseOrderId) ?? new Decimal(0);
    if (received.greaterThan(ordered)) {
      throw new ErpIntegrationError(409, `Purchase order ${purchaseOrderId} has received more than it ordered.`);
    }
    orders.push({
      id: header.id,
      supplierId: resolveSupplierId(header.supplier, supplierIds),
      productId: query.productId,
      warehouseId: query.warehouseId,
      orderedQuantity: ordered.toFixed(),
      receivedQuantity: received.toFixed(),
      status,
      expectedAt,
      sourceUri: sourceUri('companies', query.organizationId, 'purchase-orders', header.id, 'products', query.productId),
    });
  }
  if (orders.length > MAX_ROWS) throw tooManyRows();
  return orders.sort((left, right) => left.id.localeCompare(right.id));
}

export function mapPurchaseOrderStatus(value: string): PurchaseOrder['status'] {
  switch (value.trim().toLowerCase()) {
    case 'draft':
      return 'draft';
    case 'received':
      return 'received';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'partial':
    case 'partially_received':
    case 'partially received':
      return 'partially_received';
    case 'approved':
    case 'pending':
    case 'ordered':
    case 'awaiting':
      return 'approved';
    default:
      throw new ErpIntegrationError(409, `Unsupported purchase order status: ${value}.`);
  }
}

function getServiceClient(environment: ErpIntegrationEnvironment): SupabaseClient {
  if (serviceClient) return serviceClient;
  const url = environment.NEXT_PUBLIC_SUPABASE_URL;
  const secret = environment.SUPABASE_SECRET_KEY || environment.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) throw new ErpIntegrationError(503, 'ERP database access is not configured.');
  serviceClient = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return serviceClient;
}

async function requireProduct(client: SupabaseClient, query: ErpIntegrationQuery): Promise<void> {
  const result = await client
    .from('jde_products')
    .select('id')
    .eq('company_id', query.organizationId)
    .eq('id', query.productId)
    .maybeSingle();
  const product = resultData<{ id: string } | null>(result, 'inventory product');
  if (!product) throw new ErpIntegrationError(404, 'Product not found in the requested company.');
}

async function fetchInvoiceItems(
  client: SupabaseClient,
  query: ErpIntegrationQuery,
  invoiceIds: string[],
): Promise<InvoiceItemRow[]> {
  return fetchByIds<InvoiceItemRow>(
    client,
    'jde_invoice_items',
    'id,invoice_id,qty',
    'invoice_id',
    invoiceIds,
    (queryBuilder) => queryBuilder.eq('company_id', query.organizationId).eq('product_id', query.productId),
  );
}

async function fetchReturnItems(
  client: SupabaseClient,
  table: 'jde_sales_return_items' | 'jde_purchase_return_items',
  parentColumn: 'sales_return_id' | 'purchase_return_id',
  query: ErpIntegrationQuery,
  parentIds: string[],
): Promise<ReturnItemRow[]> {
  const rows = await fetchByIds<Record<string, unknown>>(
    client,
    table,
    `id,${parentColumn},qty`,
    parentColumn,
    parentIds,
    (queryBuilder) => queryBuilder.eq('company_id', query.organizationId).eq('product_id', query.productId),
  );
  return rows.map((row) => ({
    id: String(row.id),
    qty: row.qty as string | number,
    parent_id: String(row[parentColumn]),
  }));
}

async function fetchSuppliers(client: SupabaseClient, organizationId: string): Promise<SupplierRow[]> {
  const result = await client
    .from('jde_suppliers')
    .select('id,name')
    .eq('company_id', organizationId)
    .limit(MAX_ROWS + 1);
  return bounded(resultData<SupplierRow[]>(result, 'suppliers'));
}

type FilterableQuery = { eq(column: string, value: unknown): FilterableQuery };

async function fetchByIds<T>(
  client: SupabaseClient,
  table: string,
  columns: string,
  idColumn: string,
  ids: string[],
  scope?: (query: FilterableQuery) => FilterableQuery,
): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += BATCH_SIZE) {
    const batch = ids.slice(index, index + BATCH_SIZE);
    let query = client.from(table).select(columns).in(idColumn, batch) as unknown as FilterableQuery;
    if (scope) query = scope(query);
    const result = await query as unknown as { data: T[] | null; error: unknown };
    rows.push(...resultData<T[]>(result, table));
    if (rows.length > MAX_ROWS) throw tooManyRows();
  }
  return rows;
}

function appendReturnMovements(
  target: InventoryMovement[],
  items: ReturnItemRow[],
  headers: Map<string, HeaderRow>,
  query: ErpIntegrationQuery,
  kind: 'sales-return' | 'purchase-return',
  sign: 1 | -1,
): void {
  for (const item of items) {
    const header = headers.get(item.parent_id);
    if (!header?.created_at) continue;
    target.push({
      id: `${kind}:${item.id}`,
      productId: query.productId,
      warehouseId: query.warehouseId,
      direction: 'adjustment',
      quantity: decimal(item.qty, `${kind} quantity`).times(sign).toFixed(),
      occurredAt: timestamp(header.created_at, `${kind} timestamp`),
      reference: item.parent_id,
      sourceUri: sourceUri('companies', query.organizationId, `${kind}-items`, item.id),
    });
  }
}

function groupQuantities<T>(
  rows: T[],
  keyOf: (row: T) => string,
  quantityOf: (row: T) => string | number,
): Map<string, Decimal> {
  const grouped = new Map<string, Decimal>();
  for (const row of rows) {
    const key = keyOf(row);
    grouped.set(key, (grouped.get(key) ?? new Decimal(0)).plus(decimal(quantityOf(row), 'quantity')));
  }
  return grouped;
}

function supplierIndex(rows: SupplierRow[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const row of rows) {
    const key = row.name.trim().toLocaleLowerCase('en');
    index.set(key, [...(index.get(key) ?? []), row.id]);
  }
  return index;
}

function resolveSupplierId(name: string, index: Map<string, string[]>): string {
  const matches = index.get(name.trim().toLocaleLowerCase('en')) ?? [];
  if (matches.length === 1) return matches[0];
  const digest = createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 24);
  return `supplier-name:${digest}`;
}

function decimal(value: string | number, field: string): Decimal {
  try {
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error('wrong type');
    if (typeof value === 'string' && !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) {
      throw new Error('not a base-10 decimal');
    }
    const parsed = new Decimal(value);
    if (!parsed.isFinite()) throw new Error('not finite');
    return parsed;
  } catch {
    throw new ErpIntegrationError(409, `ERP data contains an invalid ${field}.`);
  }
}

function sum(values: Array<string | number>, field: string): Decimal {
  return values.reduce((total, value) => total.plus(decimal(value, field)), new Decimal(0));
}

function bounded<T>(rows: T[]): T[] {
  if (rows.length > MAX_ROWS) throw tooManyRows();
  return rows;
}

function tooManyRows(): ErpIntegrationError {
  return new ErpIntegrationError(413, 'The requested ERP result is too large; use a narrower date range.');
}

function resultData<T>(result: { data: T | null; error: unknown }, operation: string): T {
  if (result.error) {
    const message = result.error && typeof result.error === 'object' && 'message' in result.error
      ? String(result.error.message)
      : 'unknown database error';
    throw new Error(`Failed to read ${operation}: ${message}`);
  }
  return result.data as T;
}
