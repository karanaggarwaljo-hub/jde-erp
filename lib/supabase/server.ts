import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/** The one client-facing (anon-key) Supabase client in this app, used only for authentication —
 *  signing in/out and verifying a session. Every actual data read/write still goes through the
 *  separate service-role client in lib/db/index.ts, unchanged; this client never touches a
 *  jde_* table directly. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component (e.g. layout.tsx), where cookie writes aren't
            // allowed — safe to ignore there since proxy.ts already refreshes the session
            // cookie on every request. Route Handlers (login/logout/invite/accept-invite),
            // where a write actually needs to succeed, are never affected by this catch.
          }
        },
      },
    }
  );
}
