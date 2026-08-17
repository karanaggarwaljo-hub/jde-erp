import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUserRecord, type StaffUserRecord } from '@/lib/db';

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
