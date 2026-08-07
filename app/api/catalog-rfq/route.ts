import { dbErrorMessage, insertCatalogLead } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Public, unauthenticated: submits a "Request a Quote" lead from the public catalog. Never
 *  trusts a client-supplied company_id — insertCatalogLead resolves it server-side via the
 *  storefront-company flag, so there's nothing company-scoping-related to do here. */
export async function POST(request: Request) {
  const { catalogProductId, partTitle, partNumber, customerName, customerPhone, quantity, machineModel, message } = await request.json();

  if (typeof catalogProductId !== 'string' || !catalogProductId.trim()) {
    return Response.json({ error: 'catalogProductId is required.' }, { status: 400 });
  }
  if (typeof partTitle !== 'string' || !partTitle.trim()) {
    return Response.json({ error: 'partTitle is required.' }, { status: 400 });
  }
  if (typeof partNumber !== 'string' || !partNumber.trim()) {
    return Response.json({ error: 'partNumber is required.' }, { status: 400 });
  }
  if (typeof customerName !== 'string' || !customerName.trim()) {
    return Response.json({ error: 'customerName is required.' }, { status: 400 });
  }
  if (typeof customerPhone !== 'string' || !customerPhone.trim()) {
    return Response.json({ error: 'customerPhone is required.' }, { status: 400 });
  }

  try {
    await insertCatalogLead({
      catalogProductId,
      partTitle,
      partNumber,
      customerName,
      customerPhone,
      quantity: typeof quantity === 'number' && Number.isFinite(quantity) ? quantity : undefined,
      machineModel: typeof machineModel === 'string' && machineModel.trim() ? machineModel : undefined,
      message: typeof message === 'string' && message.trim() ? message : undefined,
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error('catalog-rfq route failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Could not submit your request. Please try again.') }, { status: 400 });
  }
}
