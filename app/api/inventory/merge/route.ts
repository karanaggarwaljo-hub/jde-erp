import { dbErrorMessage, isBusinessRuleError, mergeProducts } from '@/lib/db';
import { checkCompanyAccess } from '@/lib/auth/dal';
import { recordAudit } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

/**
 * Merges a part that was entered twice into the entry being kept.
 *
 * Irreversible, so it has the same shape as undoing a credit note: jde_merge_products decides what
 * may happen and does all of it atomically, and this handler only validates the request. A rule it
 * refuses — a part of another company, a part number that is neither part's own — comes back as a
 * sentence the owner can act on rather than a 500.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const text = (key: string) => (typeof value[key] === 'string' ? (value[key] as string) : '');
  const companyId = text('companyId');
  const keepId = text('keepId');
  const removeId = text('removeId');
  const partNumber = text('partNumber');
  const removeLabel = text('removeLabel').slice(0, 200);

  if (!companyId || !keepId || !removeId) {
    return Response.json({ error: 'companyId, keepId and removeId are required.' }, { status: 400 });
  }
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  if (access.user.role !== 'owner') {
    return Response.json({ error: 'Only the owner can merge parts.' }, { status: 403 });
  }
  if (keepId === removeId) {
    return Response.json({ error: 'A part cannot be merged with itself.' }, { status: 400 });
  }

  try {
    const merged = await mergeProducts(companyId, keepId, removeId, partNumber);
    await recordAudit({
      companyId, action: 'products.merge', entity: 'products', entityId: merged.id,
      summary: `Merged ${removeLabel || removeId} into ${merged.part_number ? `${merged.part_number} — ` : ''}${merged.name}, now ${merged.current_stock} in stock`,
      details: {
        kept_id: keepId, removed_id: removeId, removed: removeLabel, part_number: merged.part_number,
        moved_lines: merged.moved_lines, recosted_units: merged.recosted_units,
      },
    });
    return Response.json(merged);
  } catch (error) {
    console.error('POST /api/inventory/merge failed:', error);
    if (isBusinessRuleError(error)) {
      return Response.json({ error: dbErrorMessage(error, 'These parts could not be merged.') }, { status: 422 });
    }
    return Response.json({ error: dbErrorMessage(error, 'The parts were not merged.') }, { status: 500 });
  }
}
