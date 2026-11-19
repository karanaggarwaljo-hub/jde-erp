import { getPublishedBlogPost, listPublishedBlogPosts } from '@/lib/db';
import { bodyToHtml, readMinutes, type PublicPhoto } from '@/lib/blog';

export const dynamic = 'force-dynamic';

// The same two origins the catalogue feed allows (app/api/public/catalog/route.ts).
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
 * Public, read-only feed of the published blog posts, for the company website.
 *
 *   GET /api/public/blog              every published post, newest first, without its text, with
 *                                     its cover photo (`cover`: { url, alt } or null)
 *   GET /api/public/blog?slug=<slug>  one post with its text, as Markdown (`body`) and as ready
 *                                     HTML (`html`, its photos already placed), plus its cover,
 *                                     its other photos (`photos`) and its questions (`faq`)
 *
 * `html` is built from the same blocks as the ERP's own /blog pages draw (lib/blog.ts bodyToHtml),
 * so it contains only that handful of plain elements, with every word escaped. Drafts never appear.
 */
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get('slug')?.trim() ?? '';
  const headers = { ...corsHeaders(request), 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' };
  try {
    if (slug) {
      const post = await getPublishedBlogPost(slug);
      if (!post) return Response.json({ error: 'No published post has that address.' }, { status: 404, headers });
      const body = String(post.body ?? '');
      const photos = Array.isArray(post.photos) ? (post.photos as PublicPhoto[]) : [];
      return Response.json(
        { post: { ...post, read_minutes: readMinutes(body), html: bodyToHtml(body, photos) } },
        { headers }
      );
    }
    const posts = await listPublishedBlogPosts();
    return Response.json({ posts, updatedAt: new Date().toISOString() }, { headers });
  } catch (error) {
    console.error('GET /api/public/blog failed:', error);
    return Response.json({ error: 'The blog is temporarily unavailable.' }, { status: 503, headers: corsHeaders(request) });
  }
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
