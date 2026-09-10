import assert from 'node:assert/strict';
import test from 'node:test';
import { refuseGenericWrite, tablesMissingAnOwner } from '../lib/generic-write-guard';
import { TABLES, isWritableTable, type TableName } from '../lib/db/schema';

/** The point of the allowlist: recording one of these correctly means moving stock, a balance or
 *  a document number in the same breath. A plain row edit cannot do that, so it is refused here
 *  and done by the route that owns the whole transaction. */
const TRANSACTION_TABLES: TableName[] = [
  'invoices', 'invoice_items', 'quotations', 'purchase_orders', 'po_items', 'grns',
  'stock_layers', 'stock_consumptions', 'sales_returns', 'expenses',
  'payments_received', 'payment_allocations',
];

/** Stronger than refused: these are not in TABLES at all, so the generic route answers 404 and
 *  never looks at them. They exist only so a restore can put supplier payments back. */
const NOT_REACHABLE_AT_ALL = ['supplier_payments', 'supplier_payment_allocations'];

/** Names, prices, contact details, catalogue copy. Here a plain edit really is the whole change. */
const MASTER_DATA: TableName[] = [
  'companies', 'products', 'customers', 'suppliers', 'users', 'catalog_products', 'catalog_leads',
];

for (const table of TRANSACTION_TABLES) {
  test(`${table} cannot be written through the generic table route`, () => {
    assert.equal(isWritableTable(table), false);
    for (const action of ['create', 'edit', 'delete'] as const) {
      const refusal = refuseGenericWrite(table, action);
      assert.ok(refusal, `${table} ${action} was allowed through`);
      assert.equal(refusal.status, 403);
    }
  });
}

for (const table of MASTER_DATA) {
  test(`${table} is still editable through the generic table route`, () => {
    assert.equal(isWritableTable(table), true);
    assert.equal(refuseGenericWrite(table, 'edit'), null);
  });
}

for (const table of NOT_REACHABLE_AT_ALL) {
  test(`${table} is not reachable through the generic table route at all`, () => {
    assert.equal(table in TABLES, false, 'publishing it to the browser would need a deliberate decision');
    assert.equal(isWritableTable(table as TableName), false, 'unknown must never read as writable');
  });
}

test('every table is one or the other, so a new one cannot land in neither list', () => {
  const known = new Set(Object.keys(TABLES));
  const covered = new Set([...TRANSACTION_TABLES, ...MASTER_DATA]);
  const uncovered = [...known].filter((table) => !covered.has(table as TableName));
  assert.deepEqual(uncovered, ['catalog_events'],
    'a table was added without deciding whether it may be written generically');
});

test('a refused table names the screen that does own the write', async () => {
  const refusal = refuseGenericWrite('purchase_orders', 'edit');
  assert.ok(refusal);
  const body = await refusal.json() as { error: string };
  assert.match(body.error, /Purchases/,
    'the message has to say where to do it, not only that it was refused');
});

test('no refusable table falls through to the vague message', () => {
  assert.deepEqual(tablesMissingAnOwner(), [],
    'these tables would be refused without saying where the work belongs');
});

/** The specific hole this closes. Marking a purchase order paid through a generic PATCH moved
 *  nothing off what the supplier was owed; a failure partway through a loop of them left orders
 *  paid with the payable untouched. jde_pay_supplier does the whole thing or none of it. */
test('a purchase order can no longer be marked paid by a plain row edit', () => {
  assert.ok(refuseGenericWrite('purchase_orders', 'edit'));
});
