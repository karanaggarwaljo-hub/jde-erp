import { checkCompanyAccess } from '@/lib/auth/dal';
import { dbErrorMessage, isSupportedCatalogImageType, removeStoredPartPhoto, setPartPhoto, uploadPartPhoto } from '@/lib/db';
import { recordAudit } from '@/lib/audit-log';
import { ownPhotoPath } from '@/lib/part-photos';

export const dynamic = 'force-dynamic';

// The browser shrinks a photo to well under this before sending it. The cap is what stops a raw
// camera file reaching storage if that step is ever skipped, and it sits under Vercel's ~4.5MB
// request ceiling so the refusal is this sentence rather than a platform error.
const MAX_PHOTO_BYTES = 3.5 * 1024 * 1024;

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** Adds or replaces the owner's own photo of a part. */
export async function POST(request: Request) {
  const body = await readBody(request);
  const companyId = text(body.companyId);
  const productId = text(body.productId);
  const base64 = text(body.base64);
  const mimeType = text(body.mimeType);

  if (!companyId || !productId) return Response.json({ error: 'companyId and productId are required.' }, { status: 400 });
  if (!base64) return Response.json({ error: 'No photo was sent.' }, { status: 400 });
  if (!isSupportedCatalogImageType(mimeType)) return Response.json({ error: 'Please use a JPEG, PNG or WebP photo.' }, { status: 400 });
  const bytes = Buffer.byteLength(base64, 'base64');
  if (bytes === 0 || bytes > MAX_PHOTO_BYTES) {
    return Response.json({ error: 'That photo is too large. Please try a smaller one.' }, { status: 400 });
  }

  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  try {
    const stored = await uploadPartPhoto(companyId, productId, base64, mimeType);
    const result = await setPartPhoto(companyId, productId, stored.url);
    if (!result) {
      await removeStoredPartPhoto(stored.path);
      return Response.json({ error: 'That part is not in this company.' }, { status: 404 });
    }
    const old = ownPhotoPath(result.previous);
    if (old && old !== stored.path) await removeStoredPartPhoto(old);

    await recordAudit({
      companyId, action: 'products.photo', entity: 'products', entityId: productId,
      summary: `${result.previous ? 'Changed' : 'Added'} the photo of ${String(result.row.name ?? 'a part')}`,
      details: { image_url: stored.url, previous: result.previous },
    });
    return Response.json(result.row);
  } catch (error) {
    console.error('POST /api/inventory/part-photo failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'The photo was not saved.') }, { status: 500 });
  }
}

/** Takes the owner's own photo off a part. A published catalog picture, if there is one, shows
 *  again in its place — that picture is never touched from here. */
export async function DELETE(request: Request) {
  const body = await readBody(request);
  const companyId = text(body.companyId);
  const productId = text(body.productId);
  if (!companyId || !productId) return Response.json({ error: 'companyId and productId are required.' }, { status: 400 });

  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  try {
    const result = await setPartPhoto(companyId, productId, null);
    if (!result) return Response.json({ error: 'That part is not in this company.' }, { status: 404 });
    const old = ownPhotoPath(result.previous);
    if (old) await removeStoredPartPhoto(old);
    if (result.previous) {
      await recordAudit({
        companyId, action: 'products.photo', entity: 'products', entityId: productId,
        summary: `Removed the photo of ${String(result.row.name ?? 'a part')}`,
        details: { previous: result.previous },
      });
    }
    return Response.json(result.row);
  } catch (error) {
    console.error('DELETE /api/inventory/part-photo failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'The photo was not removed.') }, { status: 500 });
  }
}
