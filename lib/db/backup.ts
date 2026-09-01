import {
  listAllRows,
  listBackupObjects,
  uploadBackupObject,
  removeBackupObjects,
  createBackupSignedUrl,
} from './index';
import { TABLES, type TableName } from './schema';

/** Daily JSON snapshots of every jde_ table, kept in a private Supabase Storage bucket.
 *
 *  These used to be written to a `data/backups/` folder on the machine running the app, which
 *  worked for the desktop build but not once the ERP moved to erp.jd-enterprise.com: a hosted
 *  function has a read-only filesystem and no long-lived process, so every attempt failed with
 *  ENOENT and no snapshot had been taken since the move. Storage is the durable equivalent, and
 *  the schedule now comes from a real cron trigger (see app/api/cron/backup/route.ts) rather
 *  than a setInterval that only ever survived on a machine that stayed switched on.
 *
 *  Supabase itself remains the source of truth; this is the secondary net that exists because
 *  the free tier has no point-in-time recovery. */

const BACKUP_RETENTION_DAYS = 7;
const BACKUP_FILENAME_PREFIX = 'erp-backup-';

/** Matches exactly what timestampForFilename produces below, and nothing else. Used to vet any
 *  filename that arrives from the browser before it is handed to Storage as an object key. */
const BACKUP_FILENAME_PATTERN = /^erp-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/;

function timestampForFilename(date: Date): string {
  return date.toISOString().replace(/:/g, '-').replace(/\..+/, '');
}

/** The inverse of timestampForFilename, used when Storage hands back a null created_at (its
 *  types allow it). The filename is the same instant recorded a second way, so reading it back
 *  keeps the list ordered and, more importantly, keeps pruning honest — a fabricated "now"
 *  would make an old snapshot look fresh and stop it ever being cleaned up. */
function timestampFromFilename(filename: string): string {
  const stamp = filename.slice(BACKUP_FILENAME_PREFIX.length, -'.json'.length);
  const [datePart, timePart] = stamp.split('T');
  return `${datePart}T${timePart.replace(/-/g, ':')}Z`;
}

export function isValidBackupFilename(filename: string): boolean {
  return BACKUP_FILENAME_PATTERN.test(filename);
}

export type BackupInfo = { filename: string; size_bytes: number; created_at: string };

export async function listBackups(): Promise<BackupInfo[]> {
  const objects = await listBackupObjects();
  return objects
    // Strict match rather than a prefix check, so anything unexpected in the bucket is left
    // alone instead of being listed as a backup — or, worse, pruned as one.
    .filter((object) => isValidBackupFilename(object.name))
    .map((object) => ({
      filename: object.name,
      size_bytes: object.size_bytes,
      created_at: object.created_at ?? timestampFromFilename(object.name),
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function pruneOldBackups(retentionDays: number = BACKUP_RETENTION_DAYS): Promise<string[]> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const expired = (await listBackups())
    .filter((backup) => new Date(backup.created_at).getTime() < cutoff)
    .map((backup) => backup.filename);
  await removeBackupObjects(expired);
  return expired;
}

export async function backupDatabase(): Promise<BackupInfo> {
  const tableNames = Object.keys(TABLES) as TableName[];
  // listAllRows, not listRows: a backup has to page past Supabase's 1000-row API cap, or it
  // silently stops mid-table and still looks like a complete file.
  //
  // All tables at once rather than one after another. Read sequentially, nineteen round trips to
  // Supabase took ~11s from here — fine now, but it grows with the data, and this job has a hard
  // ceiling it must finish inside. It also makes the snapshot *more* coherent, not less: there is
  // no transaction spanning these reads either way, so the shorter the window they span, the less
  // chance of a sale landing between two tables and being half-captured. Nineteen is the fixed
  // table count from the schema, not something user data can inflate, so this needs no throttle.
  const tables = await Promise.all(tableNames.map((table) => listAllRows(table)));
  const snapshot: Record<string, Array<Record<string, unknown>>> = Object.fromEntries(
    tableNames.map((table, i) => [table, tables[i]])
  );

  const now = new Date();
  const filename = `${BACKUP_FILENAME_PREFIX}${timestampForFilename(now)}.json`;
  const contents = JSON.stringify(
    {
      exported_at: now.toISOString(),
      // Row counts are recorded next to the data so a restore can tell a genuinely empty table
      // apart from one that failed to come across.
      row_counts: Object.fromEntries(tableNames.map((table) => [table, snapshot[table].length])),
      tables: snapshot,
    },
    null,
    2
  );

  await uploadBackupObject(filename, contents);
  await pruneOldBackups();

  return { filename, size_bytes: Buffer.byteLength(contents, 'utf8'), created_at: now.toISOString() };
}

export async function hasBackupToday(): Promise<boolean> {
  const todayStr = new Date().toISOString().slice(0, 10);
  return (await listBackups()).some((backup) => backup.created_at.slice(0, 10) === todayStr);
}

export async function backupIfNeededToday(): Promise<BackupInfo | null> {
  if (await hasBackupToday()) return null;
  return backupDatabase();
}

/** Callers must have already checked isValidBackupFilename — this refuses anything else rather
 *  than trusting it, so a crafted name can never be turned into an object key of its own. */
export async function getBackupDownloadUrl(filename: string): Promise<string> {
  if (!isValidBackupFilename(filename)) throw new Error('Not a backup filename.');
  return createBackupSignedUrl(filename, 60);
}
