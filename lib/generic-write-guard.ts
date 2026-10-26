import { isWritableTable, TABLES, type TableName } from '@/lib/db/schema';

/**
 * Which screen actually writes each table that /api/local refuses, so the refusal can say where
 * the work belongs rather than only that it was refused.
 */
const WRITTEN_ELSEWHERE: Partial<Record<TableName, string>> = {
  invoices: 'Sales',
  invoice_items: 'Sales',
  sales_returns: 'the return dialog in Sales',
  purchase_returns: 'the return dialog in Purchases',
  quotations: 'Sales',
  purchase_orders: 'Purchases',
  po_items: 'Purchases',
  grns: 'Purchases',
  expenses: 'Expenses',
  stock_layers: 'Purchases and Inventory',
  stock_consumptions: 'Sales',
  payments_received: 'Sales',
  payment_allocations: 'Sales',
  supplier_payments: 'Suppliers',
  supplier_payment_allocations: 'Suppliers',
  catalog_events: 'the public catalogue',
};

/**
 * Columns of master-data tables that a plain edit must never set. A part's stock moves only with a
 * stock batch (a purchase, a sale, a count), and what a customer or supplier owes only with the
 * bill, payment or return behind it: written directly they drift from the records that explain them
 * (audit, October 2026). Edits drop these; a new customer or supplier starts owing nothing.
 */
const PROTECTED_COLUMNS: Partial<Record<TableName, string[]>> = {
  products: ['current_stock'],
  customers: ['balance'],
  suppliers: ['balance'],
};

/** The patch without the columns a plain edit may not set. */
export function withoutProtectedColumns(table: TableName, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...patch };
  for (const column of PROTECTED_COLUMNS[table] ?? []) delete out[column];
  return out;
}

/** A new customer or supplier owes, or is owed, nothing until a bill or purchase says otherwise. */
export function withOpeningBalance(table: TableName, row: Record<string, unknown>): Record<string, unknown> {
  return table === 'customers' || table === 'suppliers' ? { ...row, balance: 0 } : row;
}

/** Every non-writable table names the screen that owns it. Exported so a test can prove that a
 *  table added later cannot quietly fall through to the vague message. */
export function tablesMissingAnOwner(): string[] {
  return (Object.keys(TABLES) as TableName[])
    .filter((table) => !isWritableTable(table) && !WRITTEN_ELSEWHERE[table]);
}

/**
 * The generic table route may only write master data — see `writable` in lib/db/schema.ts.
 *
 * Everything else is part of a transaction: recording it correctly means moving stock, a balance
 * or a document number in the same breath, which one plain row edit cannot do. Those writes have
 * their own routes, each calling a single database function that does all of it or none of it.
 * Refusing here is what stops a purchase order being marked paid while the payable stands still,
 * or an invoice total changing without the customer's balance following it.
 *
 * Returns null when the write may proceed, or the refusal to send back.
 */
export function refuseGenericWrite(table: TableName, action: 'create' | 'edit' | 'delete'): Response | null {
  if (isWritableTable(table)) return null;
  const screen = WRITTEN_ELSEWHERE[table];
  const verb = action === 'create' ? 'created' : action === 'edit' ? 'changed' : 'deleted';
  return Response.json(
    {
      error: screen
        ? `These records are ${verb} through ${screen}, not this endpoint — going through ${screen} is what keeps stock and balances moving with them.`
        : `These records cannot be ${verb} through this endpoint.`,
    },
    { status: 403 }
  );
}
