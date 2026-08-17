import { inviteStaffUser, insertRow, getActiveCompanyId, dbErrorMessage } from '@/lib/db';
import { isRole } from '@/lib/authTypes';
import { resolveSiteOrigin } from '@/lib/supabase/server';

/** Owner-only — enforced centrally by proxy.ts (see its OWNER_ONLY_PREFIXES), not re-checked
 *  here, so this stays a thin wrapper around the two things a real invite actually needs. */
export async function POST(request: Request) {
  const { email, name, role } = await request.json();
  if (typeof email !== 'string' || !email || typeof name !== 'string' || !name || typeof role !== 'string' || !isRole(role) || role === 'owner') {
    return Response.json({ error: 'A name, email, and valid role are required.' }, { status: 400 });
  }

  const redirectTo = new URL('/auth/callback', resolveSiteOrigin(request)).toString();

  try {
    await inviteStaffUser(email, name, redirectTo);
  } catch (error) {
    console.error('POST /api/auth/invite failed (Supabase invite):', error);
    return Response.json({ error: dbErrorMessage(error, 'Could not send the invite email — that address may already have an account.') }, { status: 400 });
  }

  try {
    const company_id = await getActiveCompanyId();
    await insertRow('users', { email, name, role, status: 'invited', company_id });
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error('POST /api/auth/invite failed (jde_users insert):', error);
    return Response.json({ error: dbErrorMessage(error, 'Invite email sent, but saving the staff record failed — check Settings.') }, { status: 500 });
  }
}
