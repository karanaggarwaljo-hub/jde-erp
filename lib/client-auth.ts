async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${url} failed`);
  return res.json();
}

/** Signs in, then redirects to /dashboard on success. Throws with the server's real message
 *  (a wrong password and a "not set up for this ERP yet" account both come back as distinct,
 *  real error text — see app/api/auth/login/route.ts). */
export function login(email: string, password: string) {
  return postJson<{ role: string; name: string | null }>('/api/auth/login', { email, password });
}

export function logout() {
  return postJson<{ ok: true }>('/api/auth/logout');
}

/** Always resolves the same way regardless of whether the email has an account — see
 *  app/api/auth/forgot-password/route.ts. */
export function forgotPassword(email: string) {
  return postJson<{ ok: true }>('/api/auth/forgot-password', { email });
}

/** Owner-only — sends a real Supabase invite email and creates the jde_users row (status:
 *  'invited') in one request. See app/api/auth/invite/route.ts. */
export function inviteUser(email: string, name: string, role: string) {
  return postJson<{ ok: true }>('/api/auth/invite', { email, name, role });
}

/** Sets the password on the invitee's own (already-valid, from the emailed link) session, and
 *  flips their jde_users status from 'invited' to 'active' in the same request. */
export function acceptInvite(password: string) {
  return postJson<{ ok: true }>('/api/auth/accept-invite', { password });
}
