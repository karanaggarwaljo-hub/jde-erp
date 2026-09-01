import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getUserRecord } from '@/lib/db';


// Next.js 16 renamed `middleware.ts` to `proxy.ts` (same mechanism, new name/export). Runs on
// the Node.js runtime in this version (not edge, and cannot be configured to be) — which is
// what makes it safe to do a real getUser() round trip and a real jde_users lookup here, for
// every request, instead of only a cheap/optimistic cookie-presence check.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)'],
};


// Reachable by anyone, no session required at all.
// sitemap.xml/robots.txt matter here specifically: without this, an unauthenticated crawler
// hitting either gets redirected to /login like any other page — which is what actually produced
// Search Console's "Sitemap is HTML" error, not merely the routes being absent before app/sitemap.ts
// and app/robots.ts existed.
const PUBLIC_EXACT = new Set(['/login', '/forgot-password', '/auth/callback', '/api/auth/login', '/api/auth/logout', '/api/auth/forgot-password', '/api/catalog-rfq', '/api/catalog-event', '/api/public/catalog', '/sitemap.xml', '/robots.txt']);
const PUBLIC_PREFIXES = ['/catalog'];


// Reachable with a valid Supabase session even when there's no active jde_users row yet — the
// invite-acceptance flow is, by definition, for someone who isn't fully set up.
const SESSION_ONLY_EXACT = new Set(['/accept-invite', '/api/auth/accept-invite']);


// Machine-to-machine endpoints authenticate themselves with a dedicated, company-scoped bearer
// token inside their Route Handlers. They must bypass the browser's Supabase-cookie gate, but are
// not public: a missing/invalid integration token is rejected before any database read occurs.
//
// /api/cron belongs here rather than in PUBLIC_EXACT above: a Vercel Cron request carries no
// session cookie, so it has to bypass the browser gate, but "reachable by anyone, no session
// required at all" is emphatically not what these routes are. Each one checks a Bearer
// CRON_SECRET itself and refuses everybody when that secret is missing or too short.
const SERVICE_AUTH_PREFIXES = ['/api/integration/v1', '/api/internal/adaptive-platform', '/api/cron'];


function matchesAny(pathname: string, exact: Set<string>, prefixes: string[] = []): boolean {
  if (exact.has(pathname)) return true;
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function isServiceAuthenticatedPath(pathname: string): boolean {
  return matchesAny(pathname, new Set(), SERVICE_AUTH_PREFIXES);
}


// The one screen/actions that can delete a whole company or change other people's access.
// /api/companies/active is deliberately excluded even though it shares the /api/companies
// prefix — CompanyProvider calls it on mount for every dashboard page, for every role.
//
// /api/backup covers listing, creating and downloading snapshots. The Settings screen it is
// reached from was already owner-only, but the routes behind it were not, so any active staff
// login could pull a JSON copy of every company's data straight from the API.
function isOwnerOnlyPath(pathname: string): boolean {
  if (pathname === '/api/companies/active') return false;
  if (pathname.startsWith('/api/companies/')) return true;
  return matchesAny(pathname, new Set(), ['/settings', '/api/auth/invite', '/api/local/users', '/api/local/companies', '/api/backup']);
}


export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;


  if (matchesAny(pathname, PUBLIC_EXACT, PUBLIC_PREFIXES)) {
    return NextResponse.next();
  }


  if (isServiceAuthenticatedPath(pathname)) {
    return NextResponse.next({ request });
  }


  // @supabase/ssr needs to both read and rewrite cookies on this exact response — getUser()
  // can silently refresh a near-expiry token, and those refreshed cookies live on whatever
  // `response` currently is. Every branch below must carry them forward, never a bare
  // `NextResponse.next()`/`.redirect()`/`.json()`, or sessions will randomly appear to expire.
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );


  const deny = (status: 401 | 403, redirectReason: string) => {
    const denied = pathname.startsWith('/api/')
      ? NextResponse.json({ error: status === 401 ? 'Authentication required.' : 'Forbidden.' }, { status })
      : NextResponse.redirect(new URL(`${status === 403 ? '/dashboard' : '/login'}?error=${redirectReason}`, request.url));
    response.cookies.getAll().forEach((cookie) => denied.cookies.set(cookie));
    return denied;
  };


  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) {
    return deny(401, 'no_session');
  }


  if (SESSION_ONLY_EXACT.has(pathname)) {
    return response;
  }


  // Authorization layer: a valid Supabase login is necessary but not sufficient — the
  // identity must also have an active jde_users row. Same rule as lib/auth/dal.ts's
  // getCurrentUser(), applied here as the actual, primary gate for every request.
  let staffUser;
  try {
    staffUser = await getUserRecord(user.email);
  } catch (dbError) {
    console.error('proxy.ts: jde_users lookup failed:', dbError);
    return deny(401, 'no_access');
  }


  if (!staffUser || staffUser.status !== 'active') {
    return deny(401, staffUser?.status === 'invited' ? 'inactive' : 'no_access');
  }


  if (isOwnerOnlyPath(pathname) && staffUser.role !== 'owner') {
    return deny(403, 'forbidden');
  }


  // Cheap identity handoff for app/(dashboard)/layout.tsx's belt-and-suspenders check — set on
  // the forwarded *request* (not the response) so a Server Component can read it via headers().
  // Percent-encoded since a real staff name may contain non-ASCII characters HTTP headers can't.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-jde-user-email', user.email);
  requestHeaders.set('x-jde-user-role', staffUser.role);
  requestHeaders.set('x-jde-user-name', encodeURIComponent(staffUser.name ?? ''));


  const finalResponse = NextResponse.next({ request: { headers: requestHeaders } });
  response.cookies.getAll().forEach((cookie) => finalResponse.cookies.set(cookie));
  return finalResponse;
}
