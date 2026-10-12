import { timingSafeEqual } from 'node:crypto';
import { backupIfNeededToday, pruneOldBackups } from '@/lib/db/backup';
import { dbErrorMessage } from '@/lib/db';
import { syncInvoicePdfs } from '@/lib/invoice-archive';
import { connectedCompanyIds, syncInvoicePdfsToDrive } from '@/lib/invoice-drive';
import { clearUnusedBills, syncBillsToDrive } from '@/lib/purchase-bills';
import { ALL_COMPANIES, recordAudit, SYSTEM_ACTOR } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';
// Nineteen tables, each paged, then a multi-megabyte upload. Nowhere near a minute in practice
// (the whole database is a few thousand rows), but the default 10s ceiling is not worth risking
// on the one job whose entire purpose is to have already run when something goes wrong.
export const maxDuration = 60;

/** The daily snapshot trigger, called by Vercel Cron — see the `crons` entry in vercel.json.
 *
 *  /api/cron is a SERVICE_AUTH_PREFIX in proxy.ts, because a cron request arrives with no browser
 *  session and no cookies, so the normal Supabase-session gate would reject it. That makes the
 *  secret check below the *only* thing standing in front of a read of every table, so it fails
 *  closed: no usable CRON_SECRET means nobody gets in, the cron included.
 *
 *  The same secret and the same 32-character floor as the adaptive-platform reconciliation job
 *  next door, deliberately — one secret for every scheduled job is the Vercel convention, and a
 *  value too short for one route should not be quietly good enough for the other. */
const MINIMUM_SECRET_LENGTH = 32;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < MINIMUM_SECRET_LENGTH) {
    console.error(
      `[backup] CRON_SECRET is ${expected ? 'shorter than 32 characters' : 'not set'} — refusing to run the scheduled backup.`
    );
    return Response.json({ error: 'Scheduled backups are not configured.' }, { status: 503 });
  }

  if (!authorized(request.headers.get('authorization'), expected)) {
    return Response.json({ error: 'Forbidden.' }, { status: 403 });
  }

  try {
    // Everything after the backup shares what is left of the 60 seconds, with a margin.
    const started = Date.now();
    const timeLeft = () => 50_000 - (Date.now() - started);
    const created = await backupIfNeededToday();
    const pruned = await pruneOldBackups();
    console.log(
      created
        ? `[backup] created ${created.filename} (${created.size_bytes} bytes), pruned ${pruned.length}`
        : `[backup] today's snapshot already exists, pruned ${pruned.length}`
    );
    // Invoice PDFs ride on the same nightly job: a payment or settlement changes what an invoice
    // prints, and this catches every such change the save itself did not. Never allowed to fail
    // the backup, and given only what is left of the time limit.
    if (created) {
      await recordAudit({
        companyId: ALL_COMPANIES, action: 'backup.auto', entity: 'backups', entityId: created.filename,
        summary: `Nightly backup taken (${created.filename})${pruned.length ? `; ${pruned.length} older one(s) past 7 days removed` : ''}`,
        actor: SYSTEM_ACTOR,
      });
    }
    const invoicePdfs = await syncInvoicePdfs({ budgetMs: Math.min(15_000, timeLeft()) }).catch((error) => {
      console.error('[invoice-pdfs] nightly sync failed:', error);
      return null;
    });
    if (invoicePdfs) console.log(`[invoice-pdfs] saved ${invoicePdfs.saved}, unchanged ${invoicePdfs.unchanged}, removed ${invoicePdfs.removed}, failed ${invoicePdfs.failed}, left for tomorrow ${invoicePdfs.remaining}`);

    // Google Drive: link any scanned bill whose purchase was saved, clear week-old scans that never
    // became a purchase, then send every company's waiting bills and invoice PDFs to its Drive.
    const drive: Record<string, unknown> = {};
    try {
      drive.unusedBillsCleared = await clearUnusedBills();
      const companies = await connectedCompanyIds();
      for (const companyId of companies) {
        const share = Math.max(0, timeLeft()) / (2 * companies.length);
        if (share < 1_000) break;
        drive[companyId] = {
          bills: await syncBillsToDrive(companyId, share),
          invoices: await syncInvoicePdfsToDrive(companyId, share),
        };
      }
      console.log('[drive] nightly sync:', JSON.stringify(drive));
    } catch (error) {
      console.error('[drive] nightly sync failed:', error);
    }
    return Response.json({ created: created?.filename ?? null, pruned, invoicePdfs, drive });
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
