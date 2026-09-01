import { getBackupDownloadUrl, isValidBackupFilename } from '@/lib/db/backup';
import { dbErrorMessage } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Hands the browser a one-minute signed URL for one snapshot and redirects to it.
 *
 *  Backups used to sit in a folder on the machine running the app, so the owner could always
 *  open one. Moving them to Storage takes that away unless something gives them back — a backup
 *  nobody can retrieve is not a safety net. Owner-only via proxy.ts, same as the rest of
 *  /api/backup; the signed URL is minted per click rather than handed out with the list, so a
 *  URL only ever exists for a file someone actually asked for. */
export async function GET(_request: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  const decoded = decodeURIComponent(filename);
  if (!isValidBackupFilename(decoded)) {
    return Response.json({ error: 'Not a backup filename.' }, { status: 400 });
  }
  try {
    return Response.redirect(await getBackupDownloadUrl(decoded), 302);
  } catch (error) {
    console.error(`GET /api/backup/download/${decoded} failed:`, error);
    return Response.json({ error: dbErrorMessage(error, 'Could not prepare that download.') }, { status: 500 });
  }
}
