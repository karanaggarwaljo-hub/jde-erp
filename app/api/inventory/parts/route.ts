import { createProduct, dbErrorMessage, isBusinessRuleError } from '@/lib/db';
import { checkCompanyAccess } from '@/lib/auth/dal';
import { describeRow, recordAudit } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

/**
 * Creates one part, with its opening stock batch, in a single database transaction.
 *
 * Everything that decides the part number lives in jde_create_product: a blank one is generated
 * from the true maximum for the company, and a typed one that is already in use is refused by
 * name. Neither can be decided correctly in the browser, which only ever sees the parts it has
 * loaded — that is how five different parts came to share the code SP-239.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const companyId = body?.companyId;
  const product = body?.product;
  const openingQty = Number(body?.openingQty);
  const openingCost = Number(body?.openingCost);

  if (typeof companyId !== 'string' || !companyId) {
    return Response.json({ error: 'companyId is required.' }, { status: 400 });
  }
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  if (!product || typeof product !== 'object' || Array.isArray(product)) {
    return Response.json({ error: 'A part is required.' }, { status: 400 });
  }
  if (!Number.isFinite(openingQty) || openingQty < 0) {
    return Response.json({ error: 'Opening stock must be zero or more.' }, { status: 400 });
  }
  if (!Number.isFinite(openingCost) || openingCost < 0) {
    return Response.json({ error: 'Cost price must be zero or more.' }, { status: 400 });
  }

  try {
    const created = await createProduct({
      companyId,
      product: product as Record<string, unknown>,
      openingQty,
      openingCost,
    });
    await recordAudit({
      companyId, action: 'products.create', entity: 'products', entityId: String(created.id ?? ''),
      summary: `Added ${describeRow('products', created)}${openingQty > 0 ? `, opening with ${openingQty} in stock` : ''}`,
      details: { part_number: created.part_number, opening_qty: openingQty, opening_cost: openingCost },
    });
    return Response.json(created, { status: 201 });
  } catch (error) {
    console.error('POST /api/inventory/parts failed:', error);
    // "Part number X is already used by another part" is a rule the owner can act on, not a fault.
    if (isBusinessRuleError(error)) {
      return Response.json({ error: dbErrorMessage(error, 'This part could not be added.') }, { status: 422 });
    }
    return Response.json({ error: dbErrorMessage(error, 'Failed to add this part.') }, { status: 500 });
  }
}
