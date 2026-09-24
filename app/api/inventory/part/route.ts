import { checkCompanyAccess } from '@/lib/auth/dal';
import { dbErrorMessage, getPartOverviewRows } from '@/lib/db';
import { buildPartOverview } from '@/lib/part-overview';
import { findAlternates, type AlternatePart } from '@/lib/part-alternates';
import { catalogPhotoIndex } from '@/lib/part-photos';

export const dynamic = 'force-dynamic';

/**
 * One part, everything about it: its own details, its stock batches, what it has sold and been
 * bought for, what came back, and which other parts in this company could be used instead.
 *
 * One request rather than six, and the alternates are worked out here because they need the whole
 * catalogue — which is on the server already, and which the browser should not have to sift.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const companyId = params.get('companyId') ?? '';
  const productId = params.get('productId') ?? '';
  if (!companyId || !productId) {
    return Response.json({ error: 'companyId and productId are required.' }, { status: 400 });
  }
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  try {
    const rows = await getPartOverviewRows(companyId, productId);
    if (!rows.product) return Response.json({ error: 'That part is not in this company.' }, { status: 404 });

    const part = rows.product as unknown as AlternatePart;
    const alternates = findAlternates(part, rows.products as unknown as AlternatePart[]).map((match) => ({
      id: match.part.id,
      part_number: String(match.part.part_number ?? ''),
      name: String(match.part.name ?? ''),
      brand: String(match.part.brand ?? ''),
      compatibility: String(match.part.compatibility ?? ''),
      current_stock: Number(match.part.current_stock ?? 0),
      sale_price: Number(match.part.sale_price ?? 0),
      why: match.why,
      detail: match.detail,
    }));

    // Shown only when the part has no photo of its own; see lib/part-photos.ts for why only published ones.
    const catalogPhoto = catalogPhotoIndex(rows.catalogRows).get(productId) ?? null;
    // What its Website Catalog listing says it fits, offered when the part itself says nothing —
    // several listings were given a fitment the part never got.
    const catalogFitment = rows.catalogRows
      .map((row) => String((row as { compatibility?: unknown }).compatibility ?? '').trim())
      .find(Boolean) ?? null;
    return Response.json({ part: rows.product, overview: buildPartOverview(rows), alternates, catalogPhoto, catalogFitment });
  } catch (error) {
    console.error('GET /api/inventory/part failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Could not load this part.') }, { status: 500 });
  }
}
