import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUserRecord, getRowCompanyId, type StaffUserRecord, type TableName } from '@/lib/db';

export type CurrentUser = StaffUserRecord;

/** Resolves the real logged-in staff member for the current request: a valid Supabase session
 *  (verified with getUser(), which round-trips to the Auth server, not the weaker getSession())
 *  AND an active jde_users row — see proxy.ts for why both layers are required. Wrapped in
 *  React's cache() so multiple call sites in the same request (layout, a page, a route handler)
 *  share one lookup instead of re-verifying repeatedly, same dedupe pattern already used by
 *  app/catalog/[id]/page.tsx's getProduct. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.email) return null;
  const record = await getUserRecord(user.email);
  if (!record || record.status !== 'active') return null;
  return record;
});

/** For pages/actions that need a real identity. proxy.ts already blocks unauthenticated
 *  requests from reaching here at all — this is defense in depth, not the primary gate. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

/** For the one screen that can delete a whole company or change other people's access —
 *  worth its own full, independent check rather than relying on proxy.ts alone. */
export async function requireOwner(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== 'owner') redirect('/dashboard?error=forbidden');
  return user;
}

/** Never thrown/redirected — API routes need a JSON {error} body on a non-2xx response
 *  (parseJsonOrThrow expects one), not a redirect landing inside a fetch() result. */
export type CompanyAccessResult =
  | { ok: true; user: CurrentUser }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Whether the current logged-in user may act on the given company's data.
 *
 * An owner may act on any company — this is the app's actual design, not an oversight: the
 * company switcher in Settings lets one owner account manage every company in this Supabase
 * project, and jde_users has no per-owner company membership table to check against, so "owner"
 * is the only thing that can mean "unrestricted" here. Anyone else is confined to their own
 * jde_users.company_id. proxy.ts already requires a valid session with an active jde_users row
 * for every route that reaches here — this is the layer that actually matters for a multi-company
 * database: which company's data this specific, legitimately-logged-in person may touch.
 *
 * Use this where the route already receives a companyId to check (most routes). Use
 * requireOwnCompanyRow below where it only receives a row id and has to look the company up.
 */
export async function checkCompanyAccess(companyId: string): Promise<CompanyAccessResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401, error: 'Authentication required.' };
  if (user.role !== 'owner' && user.company_id !== companyId) {
    return { ok: false, status: 403, error: 'You do not have access to this company’s data.' };
  }
  return { ok: true, user };
}

/** Same check as checkCompanyAccess, for the endpoints that take only a row id (generic table
 *  edit/delete, stock/balance adjust, FIFO) and never carried a company_id to check against —
 *  looks up which company the target row actually belongs to first. A row that doesn't exist is
 *  let through deliberately: the caller's own not-found handling (a 404, or a no-op) is the
 *  right response to "this id doesn't exist," not an access-denied that reveals nothing useful. */
export async function requireOwnCompanyRow(table: TableName, id: string): Promise<CompanyAccessResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401, error: 'Authentication required.' };
  if (user.role === 'owner') return { ok: true, user };
  const rowCompanyId = await getRowCompanyId(table, id);
  if (rowCompanyId !== undefined && rowCompanyId !== user.company_id) {
    return { ok: false, status: 403, error: 'You do not have access to this record.' };
  }
  return { ok: true, user };
}
