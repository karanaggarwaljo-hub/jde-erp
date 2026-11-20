import { GoogleGenAI } from '@google/genai';
import { aiFailureResponse } from '@/lib/ai/friendly-error';
import { requireOwnCompanyRow } from '@/lib/auth/dal';
import { recordAudit } from '@/lib/audit-log';
import { PHOTO_PROMPT_RULES, isCoverPlace } from '@/lib/blog';
import { getRow, isSupportedCatalogImageType, uploadBlogPhoto } from '@/lib/db';

export const dynamic = 'force-dynamic';
// Making a photo takes the image service 10 to 30 seconds; 60s is the Hobby-plan ceiling.
export const maxDuration = 60;

const MAX_PROMPT = 2000;

/**
 * Makes one photo for a blog post from its photo prompt, with the same Gemini image service the
 * Website Catalog uses (app/api/ai-catalog-generate-image), stores it like an uploaded photo
 * (lib/db uploadBlogPhoto) and answers with its public address. The Blog screen puts that address
 * in the photo's slot, exactly as after "Upload photo".
 *
 * Before this the owner copied each prompt into another app, made the photo, downloaded it and
 * uploaded it. Uploading stays for photos of his own. The post has to be the caller's own company's.
 * The cover is made wide (16:9) for the top of the post and link previews; the others 4:3.
 */
export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: 'Making photos needs the Gemini key, which is not set up. Upload a photo instead.' }, { status: 501 });

  const { postId, prompt, place } = await request.json().catch(() => ({}));
  if (typeof postId !== 'string' || !postId) return Response.json({ error: 'postId is required' }, { status: 400 });
  const asked = typeof prompt === 'string' ? prompt.replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT) : '';
  if (!asked) return Response.json({ error: 'This photo has no prompt to make it from.' }, { status: 400 });

  const access = await requireOwnCompanyRow('blog_posts', postId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  try {
    const post = await getRow('blog_posts', postId);
    if (!post) return Response.json({ error: 'That blog post was not found.' }, { status: 404 });
    const companyId = String(post.company_id ?? '');
    const cover = typeof place === 'string' && isCoverPlace(place);

    const response = await new GoogleGenAI({ apiKey }).models.generateContent({
      model: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
      // The rules are already at the end of every saved prompt (lib/blog.ts cleanImagePrompts); they
      // are added again here in case the prompt was edited, so no photo can carry a logo or writing.
      contents: `${asked}\n\n${PHOTO_PROMPT_RULES} Return one realistic photograph only.`,
      config: { imageConfig: { aspectRatio: cover ? '16:9' : '4:3' } },
    });
    if (response.promptFeedback?.blockReason) {
      return Response.json({ error: `The image service declined this prompt (${response.promptFeedback.blockReason}). Change the prompt a little and try again.` }, { status: 502 });
    }
    const image = response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
    if (!image?.data) return Response.json({ error: 'The image service sent back no photo. Please try again.' }, { status: 502 });
    const mimeType = image.mimeType && isSupportedCatalogImageType(image.mimeType) ? image.mimeType : 'image/png';

    const url = await uploadBlogPhoto(companyId, postId, image.data, mimeType);
    await recordAudit({
      companyId, action: 'blog.photo', entity: 'blog_posts', entityId: postId,
      summary: `Made a photo with AI for the blog post ${String(post.title ?? '')}`.trim(),
    });
    return Response.json({ url });
  } catch (error) {
    console.error('ai-blog-photo-generate route failed:', error);
    return aiFailureResponse(error, 'The photo could not be made.', 'image');
  }
}
