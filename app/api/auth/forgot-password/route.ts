import { createClient } from '@/lib/supabase/server';

/** Public — anyone can request a reset link for any email, by design (standard "forgot
 *  password" UX). Always responds the same way regardless of whether the email has an
 *  account, so this can't be used to check who has a login here. Supabase itself rate-limits
 *  repeated requests for the same address. */
export async function POST(request: Request) {
  const { email } = await request.json();
  if (typeof email !== 'string' || !email) {
    return Response.json({ error: 'Email is required.' }, { status: 400 });
  }

  const supabase = await createClient();
  const redirectTo = new URL('/auth/callback', request.url).toString();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    console.error('POST /api/auth/forgot-password failed:', error);
  }
  return Response.json({ ok: true });
}
