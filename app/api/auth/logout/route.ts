import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/dal';
import { ALL_COMPANIES, recordAudit } from '@/lib/audit-log';

export async function POST() {
  // Who is leaving has to be read before the session is gone.
  const user = await getCurrentUser().catch(() => null);
  const supabase = await createClient();
  await supabase.auth.signOut();
  if (user) {
    await recordAudit({
      companyId: ALL_COMPANIES, action: 'auth.signout', entity: 'users', entityId: user.email,
      summary: `${user.name || user.email} signed out`,
      actor: { email: user.email, name: user.name ?? '' },
    });
  }
  return Response.json({ ok: true });
}
