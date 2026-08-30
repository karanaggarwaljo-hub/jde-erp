/**
 * Exercises the customer tiering and flag rules in lib/customer-insights.ts.
 *
 *   npx tsx scripts/customer-insights-check.ts
 *
 * Two halves:
 *   1. Fixed cases with hand-built data, where the right answer is known — including the ones
 *      that matter most: revenue and profit disagreeing, and thin history refusing to be graded.
 *   2. A live pass over whatever is actually in the database, which asserts nothing about the
 *      grades (they depend on real trading) but proves the whole path runs on real rows and
 *      prints what it produces, so the output can be eyeballed against the business.
 *
 * No keys or login needed for part 1; part 2 uses the service-role key like the other scripts.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  buildCustomerInsights,
  INSIGHT_RULES,
  TIER_LABELS,
  FLAG_LABELS,
  type InsightsInvoice,
  type InsightsInvoiceItem,
  type InsightsConsumption,
  type InsightsCustomer,
} from '../lib/customer-insights';

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    passed += 1;
    console.log(`PASS  ${label} → ${a}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label} → got ${a}, expected ${b}`);
  }
}

const TODAY = '2026-08-25';

function invoice(over: Partial<InsightsInvoice> & { id: string; customer: string }): InsightsInvoice {
  return { date: '2026-08-01', total: 1000, paid: 1000, status: 'paid', discount_amount: 0, ...over };
}

// ── Part 1: fixed cases ──────────────────────────────────────────────────────────────────────

// The case that justifies the whole feature: "bulk" sells more but earns less than "quality".
// Ranking by revenue would call bulk the best customer; ranking by profit — what this does —
// correctly puts quality on top.
{
  const customers: InsightsCustomer[] = [
    { id: 'quality', name: 'Quality Motors' },
    { id: 'bulk', name: 'Bulk Traders' },
  ];
  const invoices: InsightsInvoice[] = [
    invoice({ id: 'A1', customer: 'Quality Motors', total: 30000 }),
    invoice({ id: 'A2', customer: 'Quality Motors', total: 20000 }),
    invoice({ id: 'B1', customer: 'Bulk Traders', total: 60000 }),
    invoice({ id: 'B2', customer: 'Bulk Traders', total: 40000 }),
  ];
  const items: InsightsInvoiceItem[] = [
    { id: 'a1', invoice_id: 'A1', line_total: 30000 },
    { id: 'a2', invoice_id: 'A2', line_total: 20000 },
    { id: 'b1', invoice_id: 'B1', line_total: 60000 },
    { id: 'b2', invoice_id: 'B2', line_total: 40000 },
  ];
  // Quality: 50k revenue, 15k cost → 35k profit. Bulk: 100k revenue, 90k cost → 10k profit.
  const consumptions: InsightsConsumption[] = [
    { invoice_item_id: 'a1', qty: 1, unit_cost: 9000 },
    { invoice_item_id: 'a2', qty: 1, unit_cost: 6000 },
    { invoice_item_id: 'b1', qty: 1, unit_cost: 54000 },
    { invoice_item_id: 'b2', qty: 1, unit_cost: 36000 },
  ];

  const result = buildCustomerInsights({ customers, invoices, items, consumptions, today: TODAY });
  const quality = result.find((row) => row.customerId === 'quality')!;
  const bulk = result.find((row) => row.customerId === 'bulk')!;

  check('higher revenue, lower profit → lower tier', [bulk.revenue > quality.revenue, bulk.tier], [true, 'gold']);
  check('most profitable customer is Diamond', quality.tier, 'diamond');
  check('profit is computed from real FIFO cost', quality.grossProfit, 35000);
  check('thin-margin customer is flagged a bargainer', bulk.flags.includes('bargainer'), true);
}

// Too little history must refuse to grade rather than guess a tier from one sale.
{
  const result = buildCustomerInsights({
    customers: [{ id: 'newbie', name: 'New Party' }],
    invoices: [invoice({ id: 'N1', customer: 'New Party', total: 90000 })],
    items: [{ id: 'n1', invoice_id: 'N1', line_total: 90000 }],
    consumptions: [{ invoice_item_id: 'n1', qty: 1, unit_cost: 1000 }],
    today: TODAY,
  });
  check('one huge sale still grades as New, not Diamond', result[0].tier, 'new');
  check('and says why', result[0].reasons[0].includes(`at least ${INSIGHT_RULES.minOrdersToGrade}`), true);
}

// A customer with no sales at all.
{
  const result = buildCustomerInsights({
    customers: [{ id: 'empty', name: 'Never Bought' }],
    invoices: [], items: [], consumptions: [], today: TODAY,
  });
  check('customer with no sales → New, zero profit', [result[0].tier, result[0].grossProfit], ['new', 0]);
}

// Flags are independent of tier: the best customer can also be the worst payer.
{
  const customers: InsightsCustomer[] = [{ id: 'big', name: 'Big Party' }, { id: 'small', name: 'Small Party' }];
  const invoices: InsightsInvoice[] = [
    invoice({ id: 'D1', customer: 'Big Party', total: 50000, paid: 0, status: 'unpaid', date: '2026-05-01' }),
    invoice({ id: 'D2', customer: 'Big Party', total: 50000 }),
    invoice({ id: 'S1', customer: 'Small Party', total: 1000 }),
    invoice({ id: 'S2', customer: 'Small Party', total: 1000 }),
  ];
  const items: InsightsInvoiceItem[] = [
    { id: 'd1', invoice_id: 'D1', line_total: 50000 },
    { id: 'd2', invoice_id: 'D2', line_total: 50000 },
    { id: 's1', invoice_id: 'S1', line_total: 1000 },
    { id: 's2', invoice_id: 'S2', line_total: 1000 },
  ];
  const consumptions: InsightsConsumption[] = [
    { invoice_item_id: 'd1', qty: 1, unit_cost: 25000 },
    { invoice_item_id: 'd2', qty: 1, unit_cost: 25000 },
    { invoice_item_id: 's1', qty: 1, unit_cost: 500 },
    { invoice_item_id: 's2', qty: 1, unit_cost: 500 },
  ];
  const result = buildCustomerInsights({ customers, invoices, items, consumptions, today: TODAY });
  const big = result.find((row) => row.customerId === 'big')!;
  check('top customer can be Diamond AND a defaulter', [big.tier, big.flags.includes('defaulter')], ['diamond', true]);
}

// Dormant is about silence, not size — and drafts must never count as a purchase.
{
  const result = buildCustomerInsights({
    customers: [{ id: 'quiet', name: 'Quiet Party' }],
    invoices: [
      invoice({ id: 'Q1', customer: 'Quiet Party', date: '2026-01-01' }),
      invoice({ id: 'Q2', customer: 'Quiet Party', date: '2026-01-05' }),
      invoice({ id: 'Q3', customer: 'Quiet Party', date: TODAY, status: 'draft' }),
    ],
    items: [], consumptions: [], today: TODAY,
  });
  check('long silence → dormant, and a draft does not count as buying', [result[0].flags.includes('dormant'), result[0].orderCount], [true, 2]);
}

// ── Part 2: live pass over the real database ─────────────────────────────────────────────────

function loadEnvLocal(): void {
  try {
    const contents = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of contents.split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // No .env.local — part 2 is skipped below, part 1 still ran.
  }
}

async function livePass(): Promise<void> {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.log('\nSKIP  live pass — Supabase keys not configured.');
    return;
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const [{ data: companies }, { data: customers }, { data: invoices }, { data: items }, { data: consumptions }] = await Promise.all([
    supabase.from('jde_companies').select('id, name'),
    supabase.from('jde_customers').select('id, name, company_id, balance'),
    supabase.from('jde_invoices').select('id, customer, date, total, paid, status, discount_amount, company_id'),
    supabase.from('jde_invoice_items').select('id, invoice_id, line_total, company_id'),
    supabase.from('jde_stock_consumptions').select('invoice_item_id, qty, unit_cost, company_id'),
  ]);

  const today = new Date().toISOString().split('T')[0];
  console.log('\nLive pass (no assertions — real trading decides these):');

  for (const company of (companies ?? []) as { id: string; name: string }[]) {
    const scoped = <T extends { company_id?: string }>(rows: T[] | null) => (rows ?? []).filter((row) => row.company_id === company.id);
    const companyCustomers = scoped(customers as ({ company_id: string } & InsightsCustomer)[] | null);
    if (companyCustomers.length === 0) {
      console.log(`  ${company.name}: no customers on file.`);
      continue;
    }
    const result = buildCustomerInsights({
      customers: companyCustomers,
      invoices: scoped(invoices as ({ company_id: string } & InsightsInvoice)[] | null),
      items: scoped(items as ({ company_id: string } & InsightsInvoiceItem)[] | null),
      consumptions: scoped(consumptions as ({ company_id: string } & InsightsConsumption)[] | null),
      today,
    });
    console.log(`  ${company.name}:`);
    for (const row of result.sort((a, b) => b.grossProfit - a.grossProfit)) {
      const flags = row.flags.map((flag) => FLAG_LABELS[flag]).join(', ');
      console.log(
        `    ${TIER_LABELS[row.tier].padEnd(8)} ${row.name.padEnd(20)} ` +
          `${row.orderCount} order(s), ₹${Math.round(row.revenue).toLocaleString('en-IN')} revenue, ` +
          `₹${Math.round(row.grossProfit).toLocaleString('en-IN')} profit` +
          (row.marginPercent === null ? '' : ` (${row.marginPercent}%)`) +
          (flags ? `  [${flags}]` : '')
      );
    }
  }
}

async function main(): Promise<void> {
  await livePass();
  console.log(`\n${passed}/${passed + failed} fixed checks passed.`);
  process.exit(failed ? 1 : 0);
}

void main();
