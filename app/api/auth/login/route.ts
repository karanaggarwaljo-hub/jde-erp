import { createClient } from '@/lib/supabase/server';
import { getUserRecord, dbErrorMessage } from '@/lib/db';

export async function POST(request: Request) {
  const { email, password } = await request.json();
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return Response.json({ error: 'Email and password are required.' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user?.email) {
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
    return Response.json({ role: record.role, name: record.name });
  } catch (dbError) {
    await supabase.auth.signOut();
    console.error('POST /api/auth/login failed:', dbError);
    return Response.json({ error: dbErrorMessage(dbError, 'Login failed.') }, { status: 500 });
  }
}
