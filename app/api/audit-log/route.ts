import { requireOwner } from '@/lib/auth/dal';
import { checkCompanyAccess } from '@/lib/auth/dal';
import { dbErrorMessage, listAuditPage, listAuditPeople } from '@/lib/db';
import { isLogKind, LOG_KINDS, searchTerm, shopDayBounds } from '@/lib/logbook';

export const dynamic = 'force-dynamic';

/**
 * The Log Book: everything that happened in one company, newest first, with who did it, when, and
 * from which device. Sign-ins and other installation-wide entries appear in every company's book.
 *
 *   company_id   required
 *   from, to     shop days (YYYY-MM-DD, India time), inclusive
 *   kind         one of LOG_KINDS (lib/logbook.ts)
 *   actor        an email address
 *   q            words to find in the entry, the person or the reference
 *   before       an instant: only entries older than it ("Show older")
 *   limit        1-500, default 100
 *   people=1     also send everyone who appears in the book, for the "Who" filter
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
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.trunc(requested), 500) : 100;
  const kind = params.get('kind');
  const before = params.get('before');
  const { start, end } = shopDayBounds(params.get('from'), params.get('to'));

  try {
    const [rows, people] = await Promise.all([
      listAuditPage({
        companyId,
        start,
        end,
        before: before && !Number.isNaN(Date.parse(before)) ? before : null,
        subjects: isLogKind(kind) ? LOG_KINDS.find((entry) => entry.key === kind)?.subjects : null,
        actorEmail: params.get('actor') || null,
        search: searchTerm(params.get('q')) || null,
        limit,
      }),
      params.get('people') === '1' ? listAuditPeople(companyId) : Promise.resolve(null),
    ]);
    return Response.json({ rows, people, hasMore: rows.length === limit });
  } catch (error) {
    console.error('GET /api/audit-log failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Could not load the Log Book.') }, { status: 500 });
  }
}
