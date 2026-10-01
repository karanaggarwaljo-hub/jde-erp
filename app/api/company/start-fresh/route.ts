import { checkCompanyAccess } from '@/lib/auth/dal';
import { dbErrorMessage, getStartFreshCounts, isBusinessRuleError, resetCompanyData } from '@/lib/db';
import { backupDatabase } from '@/lib/db/backup';
import { recordAudit } from '@/lib/audit-log';
import { describeReset } from '@/lib/start-fresh';

export const dynamic = 'force-dynamic';
// A full backup is taken before anything is cleared, and that alone can take most of the default
// 10s. Same ceiling as the backup routes.
export const maxDuration = 60;

/** Only the owner may see or do this, for the company asked about. */
async function refuseUnlessOwner(companyId: string): Promise<Response | null> {
  if (!companyId) return Response.json({ error: 'companyId is required.' }, { status: 400 });
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  if (access.user.role !== 'owner') {
    return Response.json({ error: 'Only the owner can start a company fresh.' }, { status: 403 });
  }
  return null;
}

/** How much there is to clear, delete and keep, for the confirmation card. */
export async function GET(request: Request) {
  const companyId = new URL(request.url).searchParams.get('companyId') ?? '';
  const refusal = await refuseUnlessOwner(companyId);
  if (refusal) return refusal;
  try {
    return Response.json(await getStartFreshCounts(companyId));
  } catch (error) {
    console.error('GET /api/company/start-fresh failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Could not count what would be cleared.') }, { status: 500 });
  }
}

/**
 * Starts the company fresh.
 *
 * A full backup comes first, and if it cannot be taken nothing else happens: this is the one action
 * in the ERP that deletes a business's history, and the backup is what makes it recoverable. The
 * reset itself is one database transaction that refuses unless the company's own name was typed
 * back, so a failure part-way is not possible — it either all happened or none of it did.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const companyId = typeof value.companyId === 'string' ? value.companyId : '';
  const confirm = typeof value.confirm === 'string' ? value.confirm : '';

  const refusal = await refuseUnlessOwner(companyId);
  if (refusal) return refusal;
  if (!confirm.trim()) return Response.json({ error: 'Type the company name to confirm.' }, { status: 400 });

  let backupFile: string;
  try {
    backupFile = (await backupDatabase()).filename;
  } catch (error) {
    console.error('Start fresh: the backup failed, so nothing was changed:', error);
    return Response.json({ error: 'The backup could not be taken, so nothing was changed. Try again in a minute.' }, { status: 503 });
  }

  try {
    const result = await resetCompanyData(companyId, confirm);
    const summary = describeReset(result);
    await recordAudit({
      companyId, action: 'company.start_fresh', entity: 'companies', entityId: companyId,
      summary: `Started fresh. ${summary}`,
      details: { ...result, backup: backupFile },
    });
    return Response.json({ result, summary, backup: backupFile });
  } catch (error) {
    console.error('POST /api/company/start-fresh failed:', error);
    if (isBusinessRuleError(error)) {
      return Response.json({ error: dbErrorMessage(error, 'Nothing was changed.') }, { status: 422 });
    }
    return Response.json({ error: `${dbErrorMessage(error, 'The reset did not go through.')} Nothing was changed.` }, { status: 500 });
  }
}
