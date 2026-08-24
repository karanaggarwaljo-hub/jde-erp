import type { MetadataRoute } from 'next';

// Same fallback reasoning as app/sitemap.ts — see that file's comment.
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://jd-enterprise.com').replace(/\/$/, '');

/**
 * Next.js's built-in robots convention — serves /robots.txt. Didn't exist before this, so a
 * crawler requesting it hit the same "returns an HTML page instead" problem sitemap.ts fixes.
 *
 * Everything is disallowed except the Website Catalog: this is a private ERP with one public
 * surface (see PUBLIC_PREFIXES in proxy.ts) — a crawler has no business indexing /login, /dashboard,
 * or any /api route, and letting it try would be pure noise at best.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/catalog',
      disallow: '/',
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
