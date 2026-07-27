import fs from 'node:fs';
import path from 'node:path';
import { listRows } from './index';
import { TABLES, type TableName } from './schema';

const DATA_DIR = path.join(process.cwd(), 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_RETENTION_DAYS = 7;

function timestampForFilename(date: Date): string {
  return date.toISOString().replace(/:/g, '-').replace(/\..+/, '');
}

export type BackupInfo = { filename: string; size_bytes: number; created_at: string };

export function listBackups(): BackupInfo[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((filename) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, filename));
      return { filename, size_bytes: stat.size, created_at: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function pruneOldBackups(retentionDays: number = BACKUP_RETENTION_DAYS): string[] {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const deleted: string[] = [];
  for (const backup of listBackups()) {
    if (new Date(backup.created_at).getTime() < cutoff) {
      fs.unlinkSync(path.join(BACKUP_DIR, backup.filename));
      deleted.push(backup.filename);
    }
  }
  return deleted;
}

export async function backupDatabase(): Promise<BackupInfo> {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const tableNames = Object.keys(TABLES) as TableName[];
  const snapshot: Record<string, Array<Record<string, unknown>>> = {};
  for (const table of tableNames) {
    snapshot[table] = await listRows(table);
  }

  const now = new Date();
  const filename = `erp-backup-${timestampForFilename(now)}.json`;
  const contents = JSON.stringify({ exported_at: now.toISOString(), tables: snapshot }, null, 2);
  fs.writeFileSync(path.join(BACKUP_DIR, filename), contents);

  pruneOldBackups();

  return { filename, size_bytes: fs.statSync(path.join(BACKUP_DIR, filename)).size, created_at: now.toISOString() };
}

export function hasBackupToday(): boolean {
  const todayStr = new Date().toISOString().slice(0, 10);
  return listBackups().some((b) => b.created_at.slice(0, 10) === todayStr);
}

export async function backupIfNeededToday(): Promise<BackupInfo | null> {
  if (hasBackupToday()) return null;
  return backupDatabase();
}
