import { after } from 'next/server';
import { checkCompanyAccess, requireOwner } from '@/lib/auth/dal';
import { recordAudit } from '@/lib/audit-log';
import { countInvoiceFiles, dbErrorMessage, deleteDriveConnectionRow, getDriveAppRow, getDriveConnectionRow, listPurchaseBillRows } from '@/lib/db';
import { driveFolderLink, forgetDriveSession, redirectUriFor, saveOAuthClient } from '@/lib/drive';
import { unseal } from '@/lib/drive/crypto';
import { revokeToken } from '@/lib/drive/google';
import { syncInvoicePdfsToDrive } from '@/lib/invoice-drive';
import { syncBillsToDrive } from '@/lib/purchase-bills';
import { resolveSiteOrigin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Google Drive, for the Settings screen: how it stands (GET), and the owner's actions on it (POST):
 * registering the ERP's Google app, disconnecting a company's Drive, and sending waiting files now.
 * Connecting is /api/drive/connect, which has to be a page navigation to Google.
 *
 * Owner-only (proxy.ts), and checked again here.
 */
export async function GET(request: Request) {
  await requireOwner();
  const companyId = new URL(request.url).searchParams.get('companyId') ?? '';
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  try {
    const [app, connection, bills, invoices] = await Promise.all([
      getDriveAppRow(),
      getDriveConnectionRow(companyId),
      listPurchaseBillRows(companyId),
      countInvoiceFiles(companyId),
    ]);
    const appUsable = Boolean(app && unseal(app.client_secret_enc));
    return Response.json({
      redirectUri: redirectUriFor(resolveSiteOrigin(request)),
      app: app ? { clientId: app.client_id, updatedAt: app.updated_at, usable: appUsable } : null,
      connection: connection
        ? {
            email: connection.google_email,
            connectedAt: connection.connected_at,
            connectedBy: connection.connected_by,
            folderLink: connection.root_folder_id ? driveFolderLink(connection.root_folder_id) : null,
            lastError: connection.last_error,
            lastErrorAt: connection.last_error_at,
          }
        : null,
      bills: { total: bills.length, inDrive: bills.filter((bill) => bill.drive_file_id).length },
      invoices,
    });
  } catch (error) {
    console.error('GET /api/drive failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Could not load the Google Drive settings.') }, { status: 500 });
  }
}

const CLIENT_ID_PATTERN = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

export async function POST(request: Request) {
  const owner = await requireOwner();
  const body = await request.json().catch(() => ({}));
  const action = String(body?.action ?? '');
  const companyId = String(body?.companyId ?? '');
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  try {
    if (action === 'save-app') {
      const clientId = String(body?.clientId ?? '').trim();
      const clientSecret = String(body?.clientSecret ?? '').trim();
      if (!CLIENT_ID_PATTERN.test(clientId)) {
        return Response.json({ error: 'That is not a Google Client ID. It ends in ".apps.googleusercontent.com" — copy it from the Credentials page.' }, { status: 400 });
      }
      if (clientSecret.length < 10) {
        return Response.json({ error: 'Paste the Client secret from the same Credentials page.' }, { status: 400 });
      }
      await saveOAuthClient(clientId, clientSecret, owner.email);
      await recordAudit({
        companyId, action: 'drive.setup', entity: 'drive', entityId: null,
        summary: 'Registered the ERP\'s Google app for Google Drive (the secret is stored sealed and never shown)',
        details: { client_id: clientId },
      });
      return Response.json({ ok: true });
    }

    if (action === 'disconnect') {
      const connection = await getDriveConnectionRow(companyId);
      if (!connection) return Response.json({ ok: true });
      const refreshToken = unseal(connection.refresh_token_enc);
      if (refreshToken) await revokeToken(refreshToken);
      await deleteDriveConnectionRow(companyId);
      forgetDriveSession(companyId);
      await recordAudit({
        companyId, action: 'drive.disconnect', entity: 'drive', entityId: connection.google_email,
        summary: `Disconnected Google Drive (${connection.google_email}). Files already there stay in the Drive.`,
      });
      return Response.json({ ok: true });
    }

    if (action === 'sync') {
      const bills = await syncBillsToDrive(companyId, 20_000);
      const invoices = await syncInvoicePdfsToDrive(companyId, 20_000);
      if (bills.sent + invoices.sent + bills.failed + invoices.failed > 0) {
        await recordAudit({
          companyId, action: 'drive.sync', entity: 'drive', entityId: null,
          summary: `Sent waiting files to Google Drive: ${bills.sent} supplier bill(s), ${invoices.sent} invoice PDF(s)${bills.failed + invoices.failed ? `, ${bills.failed + invoices.failed} failed` : ''}`,
          details: { bills, invoices },
        });
      }
      // Anything the time limit left is carried on after the answer, then by the nightly job.
      if (bills.waiting + invoices.waiting > 0) {
        after(async () => {
          await syncBillsToDrive(companyId, 25_000).catch(() => undefined);
          await syncInvoicePdfsToDrive(companyId, 25_000).catch(() => undefined);
        });
      }
      return Response.json({ bills, invoices });
    }

    return Response.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (error) {
    console.error(`POST /api/drive (${action}) failed:`, error);
    return Response.json({ error: dbErrorMessage(error, 'Google Drive could not be updated.') }, { status: 500 });
  }
}
