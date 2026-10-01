/**
 * What "start fresh" will do to a company, in words, before the owner confirms it.
 *
 * The reset itself is jde_reset_company_data (scripts/start-fresh.sql), which does all of it in one
 * transaction. This only describes it from live counts, so the screen never promises something the
 * database then does differently. Change one and the other must change with it.
 */

export type StartFreshCounts = {
  parts: number;
  partsWithStock: number;
  partsWithPrices: number;
  invoices: number;
  quotations: number;
  salesReturns: number;
  paymentsReceived: number;
  writeOffs: number;
  purchases: number;
  purchaseReturns: number;
  supplierPayments: number;
  expenses: number;
  customers: number;
  suppliers: number;
  liveOnWebsite: number;
};

export type StartFreshPlan = { cleared: string[]; deleted: string[]; kept: string[]; nothingToDo: boolean };

const counted = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Kind = { n: number; one: string; many?: string };

/** Everything that would be deleted, largest kinds first in the order the business thinks of them,
 *  leaving out any there are none of. */
function deletedKinds(c: Pick<StartFreshCounts, 'invoices' | 'quotations' | 'salesReturns' | 'paymentsReceived' | 'writeOffs' | 'purchases' | 'purchaseReturns' | 'supplierPayments' | 'expenses' | 'customers'>): string[] {
  const kinds: Kind[] = [
    { n: c.invoices, one: 'sales bill' },
    { n: c.quotations, one: 'quotation' },
    { n: c.salesReturns, one: 'credit note' },
    { n: c.paymentsReceived, one: 'payment received', many: 'payments received' },
    { n: c.writeOffs, one: 'settlement write-off' },
    { n: c.purchases, one: 'purchase' },
    { n: c.purchaseReturns, one: 'purchase return' },
    { n: c.supplierPayments, one: 'payment to a supplier', many: 'payments to suppliers' },
    { n: c.expenses, one: 'expense' },
    { n: c.customers, one: 'customer' },
  ];
  return kinds.filter((kind) => kind.n > 0).map((kind) => counted(kind.n, kind.one, kind.many));
}

export function startFreshPlan(c: StartFreshCounts): StartFreshPlan {
  const cleared: string[] = [];
  if (c.partsWithStock > 0) cleared.push(`Stock on ${counted(c.partsWithStock, 'part')} goes to 0`);
  if (c.partsWithPrices > 0) cleared.push(`Cost, sale price and MRP cleared on ${counted(c.partsWithPrices, 'part')}`);

  const deleted = deletedKinds(c);

  const kept = [
    `${counted(c.parts, 'part')}: names, part numbers, what they fit, brand, category and photos`,
    `${counted(c.suppliers, 'supplier')}, with what you owe them set to zero`,
  ];
  if (c.liveOnWebsite > 0) kept.push(`${counted(c.liveOnWebsite, 'listing')} live on your website`);
  kept.push('The audit log, staff logins and company details');

  return { cleared, deleted, kept, nothingToDo: cleared.length === 0 && deleted.length === 0 };
}

/** The same test the database applies: the company's own name, ignoring case and outer spaces. */
export function confirmationMatches(typed: string, companyName: string): boolean {
  const plain = (value: string) => value.trim().toLowerCase();
  return plain(typed) !== '' && plain(typed) === plain(companyName);
}

/** One sentence for the audit log and the screen, from what the database reports it did. */
export function describeReset(result: Record<string, number | undefined>): string {
  const get = (key: string) => Number(result[key] ?? 0) || 0;
  const deleted = deletedKinds({
    invoices: get('invoices'),
    quotations: get('quotations'),
    salesReturns: get('sales_returns'),
    paymentsReceived: get('payments_received'),
    writeOffs: get('write_offs'),
    purchases: get('purchases'),
    purchaseReturns: get('purchase_returns'),
    supplierPayments: get('supplier_payments'),
    expenses: get('expenses'),
    customers: get('customers'),
  });
  const parts = get('parts_cleared');
  return [
    deleted.length ? `Deleted ${deleted.join(', ')}` : 'Nothing to delete',
    `cleared stock and prices on ${counted(parts, 'part')}`,
  ].join('; ');
}
