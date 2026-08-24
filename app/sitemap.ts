import type { MetadataRoute } from 'next';
import { listPublishedCatalogProducts } from '@/lib/db';

export const dynamic = 'force-dynamic';

// This app has exactly one public-facing surface — the Website Catalog (see PUBLIC_PREFIXES in
// proxy.ts) — everything else sits behind a login and has no business being in a sitemap. Falls
// back to the same production domain already hardcoded as the catalog's CORS allowlist in
// app/api/public/catalog/route.ts, so a missing NEXT_PUBLIC_SITE_URL doesn't silently produce a
// sitemap full of localhost/preview URLs.
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://jd-enterprise.com').replace(/\/$/, '');

/**
 * Next.js's built-in sitemap convention — this file alone is what serves /sitemap.xml, with the
 * framework handling the XML formatting and content-type. Before this file existed there was no
 * route for that path at all, so a crawler's request fell through to an ordinary HTML page
 * (Search Console's "Sitemap is HTML" error) instead of a sitemap.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await listPublishedCatalogProducts();

  const productEntries: MetadataRoute.Sitemap = products.flatMap((product) => {
    const id = product.id;
    if (typeof id !== 'string' || !id) return [];
    const publishedAt = typeof product.published_at === 'string' ? new Date(product.published_at) : undefined;
    return [{
      url: `${SITE_URL}/catalog/${id}`,
      lastModified: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : undefined,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }];
  });

  return [
    { url: `${SITE_URL}/catalog`, changeFrequency: 'daily', priority: 1 },
    ...productEntries,
  ];
}
