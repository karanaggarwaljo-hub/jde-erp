import { requireOwner } from '@/lib/auth/dal';
import { checkCompanyAccess } from '@/lib/auth/dal';
import { dbErrorMessage } from '@/lib/db';
import { recentAudit } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

/**
 * The audit trail for one company, newest first.
 *
 * Owner-only, and deliberately its own route rather than another table published through
 * /api/local: the log records what everyone did, so it should not be readable by everyone. It is
 * also not writable from anywhere — entries are written server-side by the routes that perform
 * the actions, never by a request.
 */
export async function GET(request: Request) {
  await requireOwner();

  const params = new URL(request.url).searchParams;
  const companyId = params.get('company_id');
  if (!companyId) return Response.json({ error: 'company_id is required.' }, { status: 400 });

  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  const requested = Number(params.get('limit'));
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 500) : 200;

  try {
    return Response.json(await recentAudit(companyId, limit));
  } catch (error) {
    console.error('GET /api/audit-log failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Could not load the audit trail.') }, { status: 500 });
  }
}
