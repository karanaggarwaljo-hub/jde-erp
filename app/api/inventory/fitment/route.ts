import { checkCompanyAccess } from '@/lib/auth/dal';
import { dbErrorMessage, savePartFitment } from '@/lib/db';
import { recordAudit } from '@/lib/audit-log';
import { cleanFitment } from '@/lib/part-fitment';

export const dynamic = 'force-dynamic';

/**
 * Sets which machines a part fits, straight from the part's own window. Its Website Catalog
 * listing — which the public website reads — takes the new wording too, unless someone gave the
 * listing wording of its own on the catalog page. See lib/part-fitment.ts.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const companyId = typeof value.companyId === 'string' ? value.companyId : '';
  const productId = typeof value.productId === 'string' ? value.productId : '';
  const compatibility = cleanFitment(value.compatibility);

  if (!companyId || !productId) {
    return Response.json({ error: 'companyId and productId are required.' }, { status: 400 });
  }
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  try {
    const saved = await savePartFitment(companyId, productId, compatibility);
    if (!saved) return Response.json({ error: 'That part is not in this company.' }, { status: 404 });
    if (saved.before !== saved.after) {
      await recordAudit({
        companyId, action: 'products.edit', entity: 'products', entityId: productId,
        summary: compatibility
          ? `Fitment set to "${compatibility}"${saved.listingFollowed ? ', on the website listing too' : ''}`
          : `Fitment cleared${saved.listingFollowed ? ', on the website listing too' : ''}`,
        details: {
          before: { compatibility: saved.before },
          after: { compatibility: saved.after },
          website_listing: saved.listingFollowed ? 'followed' : saved.listingKept !== null ? 'kept its own wording' : 'none',
        },
      });
    }
    return Response.json(saved);
  } catch (error) {
    console.error('POST /api/inventory/fitment failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'The fitment was not saved.') }, { status: 500 });
  }
}
