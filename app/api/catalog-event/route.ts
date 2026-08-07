import { logCatalogEvent } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Public, unauthenticated, fire-and-forget analytics beacon (catalog search/view events) from
 *  the client's perspective — a broken or blocked write here must never be visible to a customer,
 *  so every failure is logged and swallowed rather than surfaced. Never trusts a client-supplied
 *  company_id; logCatalogEvent resolves it server-side via the storefront-company flag. */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const eventType = body?.eventType;
    if (eventType === 'search' || eventType === 'view') {
      await logCatalogEvent({
        eventType,
        catalogProductId: typeof body.catalogProductId === 'string' ? body.catalogProductId : undefined,
        query: typeof body.query === 'string' ? body.query : undefined,
        zeroResults: typeof body.zeroResults === 'boolean' ? body.zeroResults : undefined,
      });
    }
  } catch (error) {
    console.error('catalog-event route failed:', error);
  }
  return new Response(null, { status: 204 });
}
