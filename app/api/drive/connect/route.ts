import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { checkCompanyAccess, requireOwner } from '@/lib/auth/dal';
import { authUrl, DRIVE_STATE_COOKIE, getOAuthClient } from '@/lib/drive';
import { resolveSiteOrigin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Opened by the "Connect Google Drive" button: sends the owner to Google to choose an account and
 *  allow the ERP its own files in that Drive. */
export async function GET(request: Request) {
  await requireOwner();
  const origin = resolveSiteOrigin(request);
  const companyId = new URL(request.url).searchParams.get('companyId') ?? '';
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.redirect(`${origin}/settings?drive=error&message=${encodeURIComponent(access.error)}`, 302);

  const client = await getOAuthClient();
  if (!client) {
    return Response.redirect(`${origin}/settings?drive=error&message=${encodeURIComponent('Register the ERP with Google first (step 1 on the Google Drive tab).')}`, 302);
  }

  const nonce = randomBytes(24).toString('base64url');
  (await cookies()).set(DRIVE_STATE_COOKIE, `${nonce}.${companyId}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: origin.startsWith('https://'),
    path: '/api/drive',
    maxAge: 600,
  });
  return Response.redirect(authUrl(client, origin, nonce), 302);
}
