import { createClient } from '@/lib/supabase/server';
import { getUserRecord, dbErrorMessage } from '@/lib/db';
import { ALL_COMPANIES, recordAudit } from '@/lib/audit-log';

export async function POST(request: Request) {
  const { email, password } = await request.json();
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return Response.json({ error: 'Email and password are required.' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user?.email) {
    // Logged only for addresses that belong to someone here: a stranger guessing addresses would
    // otherwise fill the Log Book with noise.
    const known = await getUserRecord(email).catch(() => null);
    if (known) {
      await recordAudit({
        companyId: ALL_COMPANIES, action: 'auth.signin_failed', entity: 'users', entityId: known.email,
        summary: `Wrong password for ${known.name || known.email}`,
        actor: { email: known.email, name: known.name ?? '' },
      });
    }
    return Response.json({ error: 'Invalid email or password.' }, { status: 401 });
  }

  try {
    const record = await getUserRecord(data.user.email);
    if (!record || record.status !== 'active') {
      // A valid Supabase login isn't enough on its own — see lib/auth/dal.ts. Don't leave a
      // technically-valid-but-app-rejected session sitting in the browser.
      await supabase.auth.signOut();
      const message = record?.status === 'invited'
        ? 'Your invite is still pending — finish setup from your invite email first.'
        : "Your account isn't set up for this ERP yet. Contact your administrator.";
      return Response.json({ error: message }, { status: 403 });
    }
    await recordAudit({
      companyId: ALL_COMPANIES, action: 'auth.signin', entity: 'users', entityId: record.email,
      summary: `${record.name || record.email} signed in`,
      // The new session's cookie is only being set on this response, so name them directly.
      actor: { email: record.email, name: record.name ?? '' },
    });
    return Response.json({ role: record.role, name: record.name });
  } catch (dbError) {
    await supabase.auth.signOut();
    console.error('POST /api/auth/login failed:', dbError);
    return Response.json({ error: dbErrorMessage(dbError, 'Login failed.') }, { status: 500 });
  }
}
