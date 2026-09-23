import { dbErrorMessage, getPartPhotoUrl, isBusinessRuleError, isPictureInUse, mergeProducts, removeStoredPartPhoto } from '@/lib/db';
import { checkCompanyAccess } from '@/lib/auth/dal';
import { recordAudit } from '@/lib/audit-log';
import { ownPhotoPath } from '@/lib/part-photos';

export const dynamic = 'force-dynamic';

/** Deletes the duplicate's own photo once nothing shows it — which is when the kept part had a
 *  photo of its own and so did not take it. Only a file the part-photo feature stored, never a
 *  catalog picture. Best effort: the merge has already happened, and a leftover file costs a
 *  little space and nothing else. */
async function deleteLeftoverPhoto(url: string | null): Promise<boolean> {
  const path = ownPhotoPath(url);
  if (!url || !path) return false;
  try {
    if (await isPictureInUse(url)) return false;
    return await removeStoredPartPhoto(path);
  } catch (error) {
    console.error('Could not tidy up the photo of a merged part:', error);
    return false;
  }
}

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
    // Read first: once merged the duplicate is gone, and the function reports only the kept part.
    const removedPhoto = await getPartPhotoUrl(companyId, removeId);
    const merged = await mergeProducts(companyId, keepId, removeId, partNumber);
    const photoDeleted = await deleteLeftoverPhoto(removedPhoto);
    await recordAudit({
      companyId, action: 'products.merge', entity: 'products', entityId: merged.id,
      summary: `Merged ${removeLabel || removeId} into ${merged.part_number ? `${merged.part_number} — ` : ''}${merged.name}, now ${merged.current_stock} in stock`,
      details: {
        kept_id: keepId, removed_id: removeId, removed: removeLabel, part_number: merged.part_number,
        moved_lines: merged.moved_lines, recosted_units: merged.recosted_units,
        ...(photoDeleted ? { deleted_photo: removedPhoto } : {}),
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
