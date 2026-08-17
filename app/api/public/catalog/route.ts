import { listPublishedCatalogProducts } from '@/lib/db';

export const dynamic = 'force-dynamic';

const WEBSITE_ORIGINS = new Set([
  'https://jd-enterprise.com',
  'https://www.jd-enterprise.com',
]);

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('origin');
  if (!origin || !WEBSITE_ORIGINS.has(origin)) return { Vary: 'Origin' };

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

/**
 * Public, read-only feed for the customer-facing catalogue. The database helper
 * selects only explicitly published, public-safe product fields; stock counts,
 * costs, suppliers, drafts, and customer data never leave the ERP.
 */
export async function GET(request: Request) {
  try {
    const products = await listPublishedCatalogProducts();
    return Response.json(
      { products, updatedAt: new Date().toISOString() },
      {
        headers: {
          ...corsHeaders(request),
          'Cache-Control': 'no-store, max-age=0',
        },
      },
    );
  } catch (error) {
    console.error('GET /api/public/catalog failed:', error);
    return Response.json(
      { error: 'The catalogue is temporarily unavailable.' },
      { status: 503, headers: corsHeaders(request) },
    );
  }
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
