/**
 * Checks that the latest daily snapshot actually contains the database.
 *
 *   npx tsx scripts/backup-coverage-check.ts
 *
 * A backup that silently misses a table is worse than no backup, because it looks like one. On
 * 9 September 2026 every snapshot ever taken was missing five tables — quotation lines,
 * credit-note lines, both purchase-return tables, and the settlement audit trail — because the
 * backup job walked TABLES, the list of tables the *browser* is allowed to read, rather than a
 * list of what a restore needs. Every document header was present, so the file was the right
 * shape and roughly the right size, and nothing looked wrong from the outside.
 *
 * This checks the two things that would have caught it:
 *
 *   1. every table in BACKUP_TABLES is present in the snapshot
 *   2. its row count there matches the live table right now
 *
 * A count can legitimately differ if rows were written after the snapshot, so a shortfall is
 * reported with the numbers rather than assumed to be corruption — but a table that is absent,
 * or empty while the live table is not, is a genuine failure and exits non-zero.
 *
 * One thing it cannot check: a table added to the database by a migration and never added to
 * BACKUP_TABLES is invisible to this, because Supabase's REST API does not expose the catalogue
 * to enumerate against. Re-run the coverage query in the PR that adds a table, and add it to
 * BACKUP_TABLES or to NOT_BACKED_UP — the second list exists so that "left out" is always a
 * decision somebody wrote down.
 *
 * Read-only; never writes anything.
 */
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { BACKUP_ONLY_TABLES, BACKUP_TABLES, NOT_BACKED_UP } from '../lib/db/schema';

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

const BACKUP_BUCKET = 'jde-backups';

type Snapshot = {
  exported_at: string;
  row_counts: Record<string, number>;
  tables: Record<string, unknown[]>;
};

async function latestSnapshot(supabase: SupabaseClient): Promise<{ filename: string; body: Snapshot }> {
  const { data, error } = await supabase.storage.from(BACKUP_BUCKET).list('', {
    limit: 100,
    sortBy: { column: 'name', order: 'desc' },
  });
  if (error) throw error;
  const newest = (data ?? []).filter((object) => object.name.endsWith('.json'))[0];
  if (!newest) {
    console.error(`FAIL  the ${BACKUP_BUCKET} bucket has no snapshot in it at all.`);
    process.exit(1);
  }
  const download = await supabase.storage.from(BACKUP_BUCKET).download(newest.name);
  if (download.error) throw download.error;
  return { filename: newest.name, body: JSON.parse(await download.data.text()) as Snapshot };
}

async function liveCount(supabase: SupabaseClient, table: string): Promise<number | null> {
  const { count, error } = await supabase.from(`jde_${table}`).select('*', { count: 'exact', head: true });
  // A table named in BACKUP_TABLES that the database does not have is itself worth reporting,
  // rather than being counted as zero and passing.
  if (error) return null;
  return count ?? 0;
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

  const { filename, body } = await latestSnapshot(supabase);
  const ageHours = (Date.now() - new Date(body.exported_at).getTime()) / 3_600_000;
  console.log(`Latest snapshot: ${filename} (${ageHours.toFixed(1)}h old)\n`);

  const tableNames = Object.keys(BACKUP_TABLES).sort();
  const counts = await Promise.all(tableNames.map((table) => liveCount(supabase, table)));

  const failures: string[] = [];
  const behind: string[] = [];

  tableNames.forEach((table, i) => {
    const live = counts[i];
    const inSnapshot = body.tables[table];
    const wasAdded = table in BACKUP_ONLY_TABLES ? ' (newly covered)' : '';

    if (live === null) {
      failures.push(`${table} — named in BACKUP_TABLES but the database has no jde_${table}`);
      return;
    }
    if (!Array.isArray(inSnapshot)) {
      failures.push(`${table} — missing from the snapshot entirely; the live table has ${live} row(s)${wasAdded}`);
      return;
    }
    const saved = inSnapshot.length;
    if (saved === 0 && live > 0) {
      failures.push(`${table} — empty in the snapshot, ${live} row(s) live${wasAdded}`);
      return;
    }
    if (saved !== live) {
      behind.push(`${table} — ${saved} in the snapshot, ${live} live (rows written since it was taken?)`);
      return;
    }
    console.log(`  ok    ${table.padEnd(24)} ${saved}${wasAdded}`);
  });

  if (behind.length > 0) {
    console.log(`\n${behind.length} table(s) differ by count — check these are just newer rows:`);
    for (const line of behind) console.log(`  note  ${line}`);
  }

  console.log(`\nDeliberately not backed up: ${NOT_BACKED_UP.join(', ')}`);

  if (failures.length > 0) {
    console.log(`\nFAIL  ${failures.length} table(s) are not really in this backup:`);
    for (const line of failures) console.log(`  ${line}`);
    process.exit(1);
  }
  console.log(`\nPASS  all ${tableNames.length} tables present in ${filename}.`);
}

void main();
