import { after } from 'next/server';
import { cookies } from 'next/headers';
import { checkCompanyAccess, requireOwner } from '@/lib/auth/dal';
import { recordAudit } from '@/lib/audit-log';
import { getDriveConnectionRow, saveDriveConnectionRow } from '@/lib/db';
import { DRIVE_STATE_COOKIE, driveRootFolder, forgetDriveSession, getOAuthClient, redirectUriFor } from '@/lib/drive';
import { seal } from '@/lib/drive/crypto';
import { exchangeCode } from '@/lib/drive/google';
import { syncInvoicePdfsToDrive } from '@/lib/invoice-drive';
import { syncBillsToDrive } from '@/lib/purchase-bills';
import { resolveSiteOrigin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Where Google sends the owner back after they choose an account and press Allow. Trades Google's
 * one-time code for a lasting key, keeps it sealed, makes the company's folder in the Drive (which
 * proves the whole connection works), and then copies over every bill and invoice PDF the ERP
 * already has, after the page has gone back to Settings.
 */
export async function GET(request: Request) {
  const owner = await requireOwner();
  const origin = resolveSiteOrigin(request);
  const back = (outcome: 'connected' | 'error', message = '') =>
    Response.redirect(`${origin}/settings?drive=${outcome}${message ? `&message=${encodeURIComponent(message)}` : ''}`, 302);

  const params = new URL(request.url).searchParams;
  const jar = await cookies();
  const stored = jar.get(DRIVE_STATE_COOKIE)?.value ?? '';
  jar.delete({ name: DRIVE_STATE_COOKIE, path: '/api/drive' });

  if (params.get('error')) {
    return back('error', params.get('error') === 'access_denied' ? 'Google Drive was not connected: the Google screen was cancelled.' : `Google said: ${params.get('error')}`);
  }
  const dot = stored.indexOf('.');
  const nonce = dot > 0 ? stored.slice(0, dot) : '';
  const companyId = dot > 0 ? stored.slice(dot + 1) : '';
  if (!nonce || params.get('state') !== nonce) {
    return back('error', 'That Google sign-in had expired or did not start here. Press Connect Google Drive again.');
  }
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return back('error', access.error);

  const code = params.get('code') ?? '';
  const client = await getOAuthClient();
  if (!code || !client) return back('error', 'Google did not send back a sign-in code. Try again.');

  try {
    const granted = await exchangeCode(client, code, redirectUriFor(origin));
    const previous = await getDriveConnectionRow(companyId);
    // The same Google account keeps the folders already made; a different one starts its own.
    const sameAccount = previous && previous.google_email && previous.google_email === granted.email;
    await saveDriveConnectionRow({
      company_id: companyId,
      google_email: granted.email,
      refresh_token_enc: seal(granted.refreshToken),
      root_folder_id: sameAccount ? previous.root_folder_id : null,
      folders: sameAccount ? previous.folders : {},
      connected_at: new Date().toISOString(),
      connected_by: owner.email,
    });
    forgetDriveSession(companyId);
    await driveRootFolder(companyId);
    await recordAudit({
      companyId, action: 'drive.connect', entity: 'drive', entityId: granted.email,
      summary: `Connected Google Drive (${granted.email || 'Google account'}). Supplier bills and invoice PDFs will be saved there.`,
    });
    after(async () => {
      await syncBillsToDrive(companyId, 25_000).catch((error) => console.error('[drive] first copy of bills failed:', error));
      await syncInvoicePdfsToDrive(companyId, 25_000).catch((error) => console.error('[drive] first copy of invoices failed:', error));
    });
    return back('connected');
  } catch (error) {
    console.error('GET /api/drive/callback failed:', error);
    return back('error', error instanceof Error ? error.message : 'Google Drive could not be connected.');
  }
}
