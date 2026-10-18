/**
 * Checks the Profit report against the database for one company: runs the same server code the
 * report uses and prints its totals and top rows, so they can be compared with SQL.
 *
 *   npx tsx --env-file=.env.local scripts/check-profit.ts <companyId> [productId]
 */
import { getPartCostSource, getProfitSource } from '../lib/db';
import { groupProfit, profitLines, profitTotals, sortProfitRows } from '../lib/part-profit';
import { partCostHistory, partSales } from '../lib/part-cost-history';

async function main() {
  const [companyId, productId] = process.argv.slice(2);
  if (!companyId) throw new Error('Pass a company id.');
  const source = await getProfitSource(companyId, { start: null, end: null });
  const lines = profitLines(source);
  console.log('invoices', source.invoices.length, 'items', source.items.length, 'returns', source.returnItems.length, 'draws', source.consumptions.length);
  console.log('totals', profitTotals(lines));
  for (const by of ['part', 'supplier', 'customer'] as const) {
    console.log(`\nby ${by}`);
    for (const row of sortProfitRows(groupProfit(lines, by), 'profit').slice(0, 6)) {
      console.log(`  ${row.label.padEnd(36)} qty ${String(row.qty).padStart(5)}  sales ${String(row.sales).padStart(9)}  cost ${String(row.cost).padStart(9)}  profit ${String(row.profit).padStart(9)}  margin ${row.marginPercent ?? '-'}  uncosted ${row.uncostedLines}`);
    }
  }
  if (productId) {
    const part = await getPartCostSource(companyId, productId);
    if (!part) throw new Error('No such part.');
    const partLines = profitLines({ ...part.sales, parts: [part.part] }).filter((line) => line.productId === productId);
    console.log('\npart', part.part.name, JSON.stringify(partCostHistory(part.batches, part.purchases), null, 1));
    console.log('sales', JSON.stringify(partSales(partLines, new Date().toISOString().slice(0, 10)), null, 1));
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
