/**
 * Checks that every product's current_stock matches the real, audited total — the sum of its
 * own FIFO stock layers (jde_stock_layers.qty_remaining). current_stock is a denormalized
 * figure kept in step by jde_consume_stock_fifo / jde_add_stock_layer / jde_restore_stock_layers_
 * for_invoice_item every time it's touched; it should never drift from the layers on its own.
 *
 *   npx tsx scripts/stock-integrity-check.ts
 *
 * Written after finding 5 products (across both companies) where the two had drifted apart —
 * two badly (real stock 19 shown as 1; real stock 7 shown as 0) — traced to historical data,
 * not anything the current save/edit code paths still do. Corrected once by hand at the time;
 * this exists to catch it again early rather than needing another investigation from scratch.
 *
 * Exits non-zero (and lists every mismatch) if anything is wrong — safe to wire into a periodic
 * check. Read-only; never writes anything.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnvLocal(): void {
  let contents: string;
  try {
    contents = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  } catch {
    console.error('No .env.local found next to package.json — nothing to check against.');
    process.exit(1);
  }
  for (const line of contents.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
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

  const [{ data: products, error: productsError }, { data: layers, error: layersError }] = await Promise.all([
    supabase.from('jde_products').select('id, part_number, name, current_stock, company_id'),
    supabase.from('jde_stock_layers').select('product_id, qty_remaining'),
  ]);
  if (productsError) throw productsError;
  if (layersError) throw layersError;

  const layerTotals = new Map<string, number>();
  for (const layer of (layers ?? []) as { product_id: string; qty_remaining: number }[]) {
    layerTotals.set(layer.product_id, (layerTotals.get(layer.product_id) ?? 0) + Number(layer.qty_remaining));
  }

  const mismatches = ((products ?? []) as { id: string; part_number: string; name: string; current_stock: number; company_id: string }[])
    .map((product) => ({ product, realTotal: layerTotals.get(product.id) ?? 0 }))
    .filter(({ product, realTotal }) => Number(product.current_stock) !== realTotal);

  if (mismatches.length === 0) {
    console.log(`PASS  all ${products?.length ?? 0} products match their real FIFO stock layers.`);
    process.exit(0);
  }

  console.log(`FAIL  ${mismatches.length} product(s) out of sync with their real stock layers:\n`);
  for (const { product, realTotal } of mismatches) {
    console.log(`  ${product.part_number} — ${product.name}: shows ${product.current_stock}, real total is ${realTotal} (company ${product.company_id})`);
  }
  process.exit(1);
}

void main();
