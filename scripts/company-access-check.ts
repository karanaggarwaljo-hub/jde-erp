/**
 * Verifies getRowCompanyId() — the building block every "does this row belong to the caller's
 * own company" check added today relies on (requireOwnCompanyRow, used by the generic table
 * PATCH/DELETE, stock/balance adjust, and the FIFO routes).
 *
 *   npx tsx scripts/company-access-check.ts
 *
 * What this does NOT verify: the session half of the fix (checkCompanyAccess /
 * requireOwnCompanyRow's role-based branching — "is this logged-in user an owner, or does their
 * own company_id match"). That needs a real Supabase Auth session, which only exists inside a
 * browser with a real login — there is no way to fabricate one from a plain Node script, and
 * right now only one account (the owner) exists at all, so there is no second, non-owner login
 * to test the cross-tenant-rejection path against end to end. Once a non-owner staff account
 * exists, that path is worth checking for real, once, in the browser.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { getRowCompanyId } from '../lib/db';

function loadEnvLocal(): void {
  let contents: string;
  try {
    contents = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  } catch {
    console.error('No .env.local found next to package.json — nothing to test with.');
    process.exit(1);
  }
  for (const line of contents.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

let passed = 0;
let failed = 0;

function check(label: string, actual: string | undefined, expected: string | undefined): void {
  if (actual === expected) {
    passed += 1;
    console.log(`PASS  ${label} → ${actual ?? '(none)'}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label} → got "${actual}", expected "${expected}"`);
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.');
    process.exit(1);
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Real rows from each table getRowCompanyId is actually called against by the routes fixed
  // today — cross-checked here by reading the same value a completely separate query path.
  const targets: { table: 'products' | 'customers' | 'invoice_items'; sqlTable: string }[] = [
    { table: 'products', sqlTable: 'jde_products' },
    { table: 'customers', sqlTable: 'jde_customers' },
    { table: 'invoice_items', sqlTable: 'jde_invoice_items' },
  ];

  for (const { table, sqlTable } of targets) {
    // Excludes '1' — a handful of orphaned dev/test rows in jde_invoice_items carry that literal
    // string instead of a real company id (found while writing this check; flagged separately,
    // not something this check should validate against).
    const { data, error } = await supabase.from(sqlTable).select('id, company_id').neq('company_id', '1').limit(1).maybeSingle();
    if (error) throw error;
    if (!data) {
      console.log(`SKIP  ${table} — no rows to test against`);
      continue;
    }
    const row = data as { id: string; company_id: string };
    const result = await getRowCompanyId(table, row.id);
    check(`${table}: real row resolves to its own company`, result, row.company_id);
  }

  const missing = await getRowCompanyId('products', '00000000-0000-0000-0000-000000000000');
  check('nonexistent row → undefined (left for the route\'s own not-found handling)', missing, undefined);

  console.log(`\n${passed}/${passed + failed} checks passed.`);
  process.exit(failed ? 1 : 0);
}

void main();
