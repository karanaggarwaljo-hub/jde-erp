import type { MetadataRoute } from 'next';
import { listPublishedBlogPosts, listPublishedCatalogProducts } from '@/lib/db';

export const dynamic = 'force-dynamic';

// This app's public-facing surface is the Website Catalog and the blog (see PUBLIC_PREFIXES in
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
  // The blog is listed when it can be read. A failure there must not take the catalogue's entries
  // down with it, so it is logged and the sitemap carries on without the posts.
  const [products, posts] = await Promise.all([
    listPublishedCatalogProducts(),
    listPublishedBlogPosts().catch((error) => {
      console.error('sitemap: could not read the blog posts:', error);
      return [] as Array<Record<string, unknown>>;
    }),
  ]);

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

  // Published blog posts, dated by their last edit (scripts/blog-posts.sql keeps updated_at).
  const postEntries: MetadataRoute.Sitemap = posts.flatMap((post) => {
    const slug = post.slug;
    if (typeof slug !== 'string' || !slug) return [];
    const changed = new Date(String(post.updated_at ?? post.published_at ?? ''));
    return [{
      url: `${SITE_URL}/blog/${slug}`,
      lastModified: Number.isNaN(changed.getTime()) ? undefined : changed,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    }];
  });

  return [
    { url: `${SITE_URL}/catalog`, changeFrequency: 'daily', priority: 1 },
    ...productEntries,
    ...(posts.length > 0 ? [{ url: `${SITE_URL}/blog`, changeFrequency: 'weekly' as const, priority: 0.8 }] : []),
    ...postEntries,
  ];
}
