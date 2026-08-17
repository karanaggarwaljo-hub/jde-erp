import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** Where a Supabase invite-email link lands first (its redirectTo, see inviteStaffUser). Public
 *  — reachable with no session at all, since that's exactly the state whoever clicks the link
 *  is in. Exchanges the link's one-time code for a real session, then hands off to
 *  /accept-invite to set a password. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/accept-invite`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=no_access`);
}
