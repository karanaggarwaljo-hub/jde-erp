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
const PUBLIC_EXACT = new Set(['/login', '/forgot-password', '/auth/callback', '/api/auth/login', '/api/auth/logout', '/api/auth/forgot-password', '/api/catalog-rfq', '/api/catalog-event', '/api/public/catalog']);
const PUBLIC_PREFIXES = ['/catalog'];


// Reachable with a valid Supabase session even when there's no active jde_users row yet — the
// invite-acceptance flow is, by definition, for someone who isn't fully set up.
const SESSION_ONLY_EXACT = new Set(['/accept-invite', '/api/auth/accept-invite']);


function matchesAny(pathname: string, exact: Set<string>, prefixes: string[] = []): boolean {
  if (exact.has(pathname)) return true;
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}


// The one screen/actions that can delete a whole company or change other people's access.
// /api/companies/active is deliberately excluded even though it shares the /api/companies
// prefix — CompanyProvider calls it on mount for every dashboard page, for every role.
function isOwnerOnlyPath(pathname: string): boolean {
  if (pathname === '/api/companies/active') return false;
  if (pathname.startsWith('/api/companies/')) return true;
  return matchesAny(pathname, new Set(), ['/settings', '/api/auth/invite', '/api/local/users', '/api/local/companies']);
}


export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
