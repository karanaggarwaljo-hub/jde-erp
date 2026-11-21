import { recordSiteHit } from '@/lib/db';
import { indiaDay, siteHitFromBody } from '@/lib/site-visits';

export const dynamic = 'force-dynamic';

/** A real hit is a few dozen bytes; anything much larger is not one. */
const MAX_BODY = 2000;

/**
 * Public and unauthenticated: one page view or tap from the company website, counted for today
 * (lib/site-visits.ts). The website's Worker sends it on from its own /api/visit, so a visitor's
 * page never waits on it. Like /api/catalog-event, it always answers 204: a broken or refused count
 * must never show on the website. Anything that is not a page of the website is ignored.
 */
export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length <= MAX_BODY) {
      const hit = siteHitFromBody(JSON.parse(text));
      if (hit) await recordSiteHit(hit, indiaDay());
    }
  } catch (error) {
    console.error('site-hit route failed:', error);
  }
  return new Response(null, { status: 204 });
}
