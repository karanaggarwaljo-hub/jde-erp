import { listBackups, backupDatabase } from '@/lib/db/backup';
import { dbErrorMessage } from '@/lib/db';

export const dynamic = 'force-dynamic';
// Same reasoning as the cron route: reading every table and uploading the result is well inside
// a minute, but not inside the 10s default.
export const maxDuration = 60;

// Owner-only, enforced in proxy.ts — a snapshot is every row of every company's data, so this is
// not something any active staff login should be able to trigger or list.

export async function GET() {
  try {
    return Response.json(await listBackups());
  } catch (error) {
    console.error('GET /api/backup failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Failed to load backups.') }, { status: 500 });
  }
}

export async function POST() {
  try {
    return Response.json(await backupDatabase(), { status: 201 });
  } catch (error) {
    console.error('POST /api/backup failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Backup failed.') }, { status: 500 });
  }
}
