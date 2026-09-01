import { createClient } from '@supabase/supabase-js';
import { companyExists, getUserRecord } from '@/lib/db';
import { handleAdaptiveIdentity } from '@/lib/integration/adaptive-identity';
import { erpIntegrationHeaders } from '@/lib/integration/erp-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return Response.json({ error: 'Identity verification is not configured.' }, { status: 503, headers: erpIntegrationHeaders() });
  }
  // Separate anon-key client: verifying a user must not alter the service-role data client.
  const auth = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(8_000) }) },
  });
  return handleAdaptiveIdentity(request, {
    issuer: `${url.replace(/\/$/u, '')}/auth/v1`,
    async verifyUser(token) {
      const { data, error } = await auth.auth.getUser(token);
      if (error) {
        if (error.status === 429 || error.status === undefined || error.status >= 500) throw new Error('Auth unavailable.');
        return null;
      }
      const user = data.user;
      return user ? { id: user.id, email: user.email, emailConfirmed: Boolean(user.email_confirmed_at) && !user.is_anonymous } : null;
    },
    findStaff: getUserRecord,
    companyExists,
  });
}
