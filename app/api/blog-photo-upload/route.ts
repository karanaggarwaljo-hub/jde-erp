import { getRow, isSupportedCatalogImageType, uploadBlogPhoto } from '@/lib/db';
import { requireOwnCompanyRow } from '@/lib/auth/dal';
import { recordAudit } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

/** Base64 of a photo the browser has already shrunk to at most 1600px (lib/imageResize.ts). A few
 *  hundred KB in practice; this ceiling only stops something far larger being stored. */
const MAX_BASE64_LENGTH = 6_000_000;

/**
 * Stores one photo for a blog post and answers with its public address. The Blog screen then puts
 * that address in the post's photo slot. The post has to be the caller's own company's.
 */
export async function POST(request: Request) {
  const { postId, base64, mimeType } = await request.json().catch(() => ({}));
  if (typeof postId !== 'string' || !postId) return Response.json({ error: 'postId is required' }, { status: 400 });
  if (typeof base64 !== 'string' || !base64 || typeof mimeType !== 'string') {
    return Response.json({ error: 'No photo was received.' }, { status: 400 });
  }
  if (!isSupportedCatalogImageType(mimeType)) return Response.json({ error: 'Please use a JPEG, PNG or WebP photo.' }, { status: 400 });
  if (base64.length > MAX_BASE64_LENGTH) return Response.json({ error: 'This photo is too large. Please choose a smaller one.' }, { status: 413 });

  const access = await requireOwnCompanyRow('blog_posts', postId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  try {
    const post = await getRow('blog_posts', postId);
    if (!post) return Response.json({ error: 'That blog post was not found.' }, { status: 404 });
    const companyId = String(post.company_id ?? '');
    const url = await uploadBlogPhoto(companyId, postId, base64, mimeType);
    await recordAudit({
      companyId, action: 'blog.photo', entity: 'blog_posts', entityId: postId,
      summary: `Uploaded a photo for the blog post ${String(post.title ?? '')}`.trim(),
    });
    return Response.json({ url });
  } catch (error) {
    console.error('blog-photo-upload route failed:', error);
    return Response.json({ error: error instanceof Error ? error.message : 'The photo was not uploaded.' }, { status: 500 });
  }
}
