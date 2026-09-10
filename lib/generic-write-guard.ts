import { isWritableTable, TABLES, type TableName } from '@/lib/db/schema';

/**
 * Which screen actually writes each table that /api/local refuses, so the refusal can say where
 * the work belongs rather than only that it was refused.
 */
const WRITTEN_ELSEWHERE: Partial<Record<TableName, string>> = {
  invoices: 'Sales',
  invoice_items: 'Sales',
  sales_returns: 'the return dialog in Sales',
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
