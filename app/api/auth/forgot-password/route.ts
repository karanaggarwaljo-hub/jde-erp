import { createClient, resolveSiteOrigin } from '@/lib/supabase/server';
import { getUserRecord } from '@/lib/db';
import { ALL_COMPANIES, recordAudit } from '@/lib/audit-log';

export async function POST(request: Request) {
  const { email } = await request.json();
  if (typeof email !== 'string' || !email) {
    return Response.json({ error: 'Email is required.' }, { status: 400 });
  }

  const supabase = await createClient();
  const redirectTo = new URL('/auth/callback', resolveSiteOrigin(request)).toString();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    console.error('POST /api/auth/forgot-password failed:', error);
  }
  // Only for someone who works here (a stranger's guesses are not activity), and never said back to
  // the browser either way, so this page cannot be used to find out who has an account.
  const known = await getUserRecord(email).catch(() => null);
  if (known) {
    await recordAudit({
      companyId: ALL_COMPANIES, action: 'auth.reset_requested', entity: 'users', entityId: known.email,
      summary: `A password-reset email was asked for ${known.name || known.email}`,
      actor: { email: known.email, name: known.name ?? '' },
    });
  }
  return Response.json({ ok: true });
}
