/**
 * Prints one company's reorder list and dead stock, as the Stock Planning screen works them out.
 *
 *   npx tsx --env-file=.env.local scripts/check-stock-planning.ts <companyId>
 */
import { listAllRows } from '../lib/db';
import { deadStock, planParts, reorderList, type PlanBatch, type PlanPart, type PlanPurchase } from '../lib/stock-planning';

async function main() {
  const companyId = process.argv[2];
  if (!companyId) throw new Error('Pass a company id.');
  const mine = <T>(rows: Array<Record<string, unknown>>) => rows.filter((row) => row.company_id === companyId) as unknown as T[];
  const [products, invoices, items, layers, purchases] = await Promise.all(
    (['products', 'invoices', 'invoice_items', 'stock_layers', 'purchase_orders'] as const).map((table) => listAllRows(table)),
  );
  const dates = new Map(mine<{ id: string; date: string; status: string }>(invoices).filter((invoice) => invoice.status !== 'draft').map((invoice) => [invoice.id, invoice.date]));
  const sales = mine<{ invoice_id: string; product_id: string | null; qty: number }>(items)
    .filter((item) => dates.has(item.invoice_id)).map((item) => ({ product_id: item.product_id, qty: item.qty, date: dates.get(item.invoice_id)! }));
  const plans = planParts({
    parts: mine<PlanPart>(products), sales, batches: mine<PlanBatch>(layers), purchases: mine<PlanPurchase>(purchases),
    today: new Date().toISOString().slice(0, 10), settings: { windowDays: 365 },
  });
  console.log('parts', plans.length, '| sales lines', sales.length);
  console.log('\nreorder');
  for (const plan of reorderList(plans).slice(0, 8)) console.log(`  ${plan.name.padEnd(32)} stock ${plan.onHand}  sold ${plan.soldInWindow}  lasts ${plan.daysLeft ?? '-'}  order ${plan.suggestQty}  from ${plan.lastSupplier ?? '-'} @ ${plan.lastCost}`);
  console.log('\ndead (90 days)');
  for (const plan of deadStock(plans, 90).slice(0, 8)) console.log(`  ${plan.name.padEnd(32)} stock ${plan.onHand}  worth ${plan.stockValue}  last sold ${plan.lastSoldDate ?? 'never'}  idle ${plan.idleDays}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
