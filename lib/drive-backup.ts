/**
 * A copy of each company's records in its own Google Drive, every night, kept for good.
 *
 * The nightly snapshot (lib/db/backup.ts) lives in Supabase Storage for seven days only: enough to
 * undo a bad day, not to go back a month. The owner has 5 TB of Drive, so each company with a Drive
 * connected also gets its own records, compressed, in
 *
 *   JDE ERP - <company>/Backups/2026/10 October/JDE ERP backup - <company> - 2026-10-21.json.gz
 *
 * Only that company's rows (and the shared number floors), never another company's. Gzipped JSON
 * in the same shape as the Storage snapshot ({ exported_at, company, row_counts, tables }), so a
 * restore reads it the same way once it is unzipped. A few hundred kilobytes a night, so years of
 * them take well under a gigabyte.
 *
 * Server-only. Never throws into the nightly job: a failure is logged and tried again tomorrow.
 */

import { gzipSync } from 'node:zlib';
import { recordAudit, SYSTEM_ACTOR } from './audit-log';
import { datedFolderPath, driveFileName, listDriveFolder, putInDrive } from './drive';
import { getCompanyName, listAllRows, listDriveConnectionRows } from './db';
import { BACKUP_TABLES, type TableName } from './db/schema';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Every row of one company, table by table. Rows of other companies never leave here. */
export async function companySnapshot(companyId: string): Promise<{ tables: Record<string, Array<Record<string, unknown>>>; rowCounts: Record<string, number> }> {
  const names = Object.keys(BACKUP_TABLES) as TableName[];
  const all = await Promise.all(names.map((table) => listAllRows(table)));
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  names.forEach((table, index) => {
    const schema = BACKUP_TABLES[table];
    const rows = all[index];
    if (table === 'companies') tables[table] = rows.filter((row) => row.id === companyId);
    else if (schema.companyScoped) tables[table] = rows.filter((row) => row.company_id === companyId);
    // Not tied to a company (the document-number floors): kept whole, they hold no business data.
    else tables[table] = rows;
  });
  return { tables, rowCounts: Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length])) };
}

/** Puts today's copy of the company's records in its Drive, unless today's is already there.
 *  Returns the file name saved, null when there was nothing to do (or no Drive). */
export async function backupCompanyToDrive(companyId: string, today: string): Promise<string | null> {
  if (!DAY.test(today)) throw new Error('today must be YYYY-MM-DD');
  const companyName = await getCompanyName(companyId);
  const folderPath = datedFolderPath('Backups', today);
  const name = driveFileName(['JDE ERP backup', companyName, today], 'json.gz');
  const folder = await listDriveFolder(companyId, folderPath);
  if (!folder) return null;
  if (folder.files.some((file) => file.name === name)) return null;

  const { tables, rowCounts } = await companySnapshot(companyId);
  const json = JSON.stringify({ exported_at: new Date().toISOString(), company: { id: companyId, name: companyName }, row_counts: rowCounts, tables });
  const bytes = new Uint8Array(gzipSync(Buffer.from(json, 'utf8'), { level: 9 }));
  const saved = await putInDrive(companyId, {
    folderPath,
    name,
    mimeType: 'application/gzip',
    bytes,
    description: `Every record of ${companyName} in JDE ERP on ${today}, compressed. Kept by the ERP every night.`,
  });
  if (!saved) return null;
  await recordAudit({
    companyId, action: 'backup.drive', entity: 'backups', entityId: name,
    summary: `Nightly backup saved to Google Drive (${Math.max(1, Math.round(bytes.byteLength / 1024))} KB)`,
    details: { rows: Object.values(rowCounts).reduce((sum, count) => sum + count, 0), size_bytes: bytes.byteLength },
    actor: SYSTEM_ACTOR,
  });
  return name;
}

/** Tonight's Drive backup for every company with a Drive connected. Never throws. */
export async function backupAllToDrive(today: string): Promise<Record<string, string | null | { error: string }>> {
  const result: Record<string, string | null | { error: string }> = {};
  for (const row of await listDriveConnectionRows()) {
    try {
      result[row.company_id] = await backupCompanyToDrive(row.company_id, today);
    } catch (error) {
      console.error('[drive-backup] failed for', row.company_id, error);
      result[row.company_id] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  return result;
}
