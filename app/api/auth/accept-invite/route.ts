import { createClient } from '@/lib/supabase/server';
import { getUserRecord, updateRow, dbErrorMessage } from '@/lib/db';

/** Deliberately reachable with just a valid Supabase session, no ACTIVE jde_users row required
 *  (see proxy.ts's SESSION_ONLY paths) — this route serves two flows that both land here with a
 *  fresh session and nothing else: finishing an invite (status 'invited') and a forgotten-
 *  password reset for someone already active (status 'active', via /forgot-password). Either
 *  way, a real jde_users row must exist for this exact email — that's what stops any other
 *  merely-Supabase-authenticated identity from setting a password and walking in here. */
export async function POST(request: Request) {
  const { password } = await request.json();
  if (typeof password !== 'string' || password.length < 8) {
    return Response.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user?.email) {
    return Response.json({ error: 'Your link has expired — request a new one.' }, { status: 401 });
  }

  try {
    const record = await getUserRecord(user.email);
    if (!record) {
      return Response.json({ error: 'No account found for this email — contact your administrator.' }, { status: 403 });
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 400 });
    }

    if (record.status === 'invited') {
      await updateRow('users', user.email, { status: 'active' });
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error('POST /api/auth/accept-invite failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Could not set your password.') }, { status: 500 });
  }
}
