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

/** The origin baked into password-reset/invite email links (Supabase's redirectTo). Prefers a
 *  fixed, explicitly configured value over the requesting connection's own Host — request.url's
 *  host isn't guaranteed to be trustworthy on every deployment target, and there's no reason
 *  the link in an email needs to depend on it when a real production origin is known. Falls
 *  back to the request's own origin so local dev keeps working with zero extra setup. */
export function resolveSiteOrigin(request: Request): string {
  return process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
}
