import { timingSafeEqual } from 'node:crypto';
import { backupIfNeededToday, pruneOldBackups } from '@/lib/db/backup';
import { dbErrorMessage } from '@/lib/db';

export const dynamic = 'force-dynamic';
// Nineteen tables, each paged, then a multi-megabyte upload. Nowhere near a minute in practice
// (the whole database is a few thousand rows), but the default 10s ceiling is not worth risking
// on the one job whose entire purpose is to have already run when something goes wrong.
export const maxDuration = 60;

/** The daily snapshot trigger, called by Vercel Cron — see the `crons` entry in vercel.json.
 *
 *  This route is listed in proxy.ts's PUBLIC_EXACT because a cron request arrives with no
 *  browser session and no cookies, so the normal Supabase-session gate would reject it. That
 *  makes the secret check below the *only* thing standing in front of a full database read, so
 *  it fails closed: no CRON_SECRET configured means nobody gets in, including the cron. */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error('[backup] CRON_SECRET is not set — refusing to run the scheduled backup.');
    return Response.json({ error: 'Scheduled backups are not configured.' }, { status: 503 });
  }

  if (!authorized(request.headers.get('authorization'), expected)) {
    return Response.json({ error: 'Forbidden.' }, { status: 403 });
  }

  try {
    const created = await backupIfNeededToday();
    const pruned = await pruneOldBackups();
    console.log(
      created
        ? `[backup] created ${created.filename} (${created.size_bytes} bytes), pruned ${pruned.length}`
        : `[backup] today's snapshot already exists, pruned ${pruned.length}`
    );
    return Response.json({ created: created?.filename ?? null, pruned });
  } catch (error) {
    console.error('[backup] scheduled backup failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Backup failed.') }, { status: 500 });
  }
}

function authorized(header: string | null, expected: string): boolean {
  if (!header) return false;
  const provided = Buffer.from(header);
  const wanted = Buffer.from(`Bearer ${expected}`);
  // timingSafeEqual throws unless both buffers are the same length, so the length check is
  // required, not just an early exit.
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}
