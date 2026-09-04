import { GoogleGenAI, createPartFromBase64, createUserContent } from '@google/genai';
import { aiFailureResponse, friendlyAiErrorMessage } from '@/lib/ai/friendly-error';
import { updateRow, uploadCatalogImage } from '@/lib/db';

export const dynamic = 'force-dynamic';
// Fetching a reference image, calling Gemini, and writing the result to Supabase can together
// take longer than Vercel's default 10s (Hobby plan) function timeout — especially on a slow or
// retried call — which kills the function before it reaches its own error response and returns
// a platform-level error instead (not guaranteed to be JSON, unlike everything this route itself
// returns). 60s is the Hobby-plan ceiling; this gives real AI calls room to actually finish.
export const maxDuration = 60;

const MAX_REFERENCE_IMAGE_BYTES = 8 * 1024 * 1024;
const SUPPORTED_REFERENCE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type ReferenceImagePayload = { base64?: unknown; mimeType?: unknown };

function referenceImageFromPayload(value: unknown): { base64: string; mimeType: string } | null {
  if (!value || typeof value !== 'object') return null;
  const { base64, mimeType } = value as ReferenceImagePayload;
  if (typeof base64 !== 'string' || typeof mimeType !== 'string' || !SUPPORTED_REFERENCE_TYPES.has(mimeType)) return null;
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_REFERENCE_IMAGE_BYTES) return null;
  return { base64, mimeType };
}

/** Best-effort fetch for legacy references selected through web search. Generation now fails
 *  closed if this cannot be fetched instead of silently switching to text-only generation. */
async function fetchReferenceImageAsBase64(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_REFERENCE_IMAGE_BYTES) return null;
    return { base64: buffer.toString('base64'), mimeType: contentType.split(';')[0] };
  } catch {
    return null;
  }
}

/** AI image generation is an optional convenience — manual upload (see catalog-image-upload)
 *  is the primary, always-available path, so any failure here (quota, safety filter, no
 *  billing on the Gemini key, etc.) is recorded on the row and returned as a friendly error
 *  rather than blocking the workflow. */
export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'GEMINI_API_KEY is not configured. Add it to .env.local and restart the dev server.' },
      { status: 501 }
    );
  }

  const { catalogId, prompt, referenceImage, referenceImageUrl } = await request.json();
  if (typeof catalogId !== 'string' || !catalogId) {
    return Response.json({ error: 'catalogId is required' }, { status: 400 });
  }
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return Response.json({ error: 'prompt is required' }, { status: 400 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const uploadedReference = referenceImageFromPayload(referenceImage);
    const reference = uploadedReference || (typeof referenceImageUrl === 'string' && referenceImageUrl
      ? await fetchReferenceImageAsBase64(referenceImageUrl)
      : null);
    if (!reference) {
      const reason = 'Upload a real product reference photo before generating the catalogue image.';
      await updateRow('catalog_products', catalogId, { image_status: 'failed', generation_error: reason });
      return Response.json({ error: reason }, { status: 422 });
    }
    // The dedicated Imagen models/generateImages() API is being retired (shutting down
    // 2026-08-17) — Google's migration guidance is gemini-2.5-flash-image ("Nano Banana") via
    // the regular generateContent() call instead, which returns the image as an inline part
    // rather than a generatedImages[] response. Free tier, same GEMINI_API_KEY as everything else.
    // The exact uploaded product photo is attached for product fidelity. The workshop scene is
    // intentionally regenerated on every request within the controlled Jai Durga visual style.
    const contents = createUserContent([
      `${prompt}\n\nImage 1 is the exact product reference. Change only its surroundings: preserve the product, ` +
        'including every visible label, logo, marking, colour, component and proportion. Create a newly composed clean ' +
        'industrial workshop background for this request while following the specified Jai Durga catalogue style. ' +
        'Do not redraw, reinterpret, substitute or add to the product. Return one finished catalogue photograph only.',
      createPartFromBase64(reference.base64, reference.mimeType),
    ]);

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
      contents,
      // The public catalogue cards use a standard landscape crop. Keeping generation at 16:9
      // avoids the excessive empty space and inconsistent product scale caused by 21:9.
      config: { imageConfig: { aspectRatio: '16:9' } },
    });

    if (response.promptFeedback?.blockReason) {
      const reason = `Gemini declined to generate an image (${response.promptFeedback.blockReason}).`;
      await updateRow('catalog_products', catalogId, { image_status: 'failed', generation_error: reason });
      return Response.json({ error: reason }, { status: 502 });
    }

    const imagePart = response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data);
    if (!imagePart?.inlineData?.data) {
      const reason = 'The AI image service returned no image.';
      await updateRow('catalog_products', catalogId, { image_status: 'failed', generation_error: reason });
      return Response.json({ error: reason }, { status: 502 });
    }

    const mimeType = imagePart.inlineData.mimeType || 'image/png';
    const imageUrl = await uploadCatalogImage(catalogId, imagePart.inlineData.data, mimeType);
    const row = await updateRow('catalog_products', catalogId, {
      image_url: imageUrl,
      image_status: 'ready',
      generation_error: null,
    });
    return Response.json(row);
  } catch (error) {
    console.error('ai-catalog-generate-image route failed:', error);
    // The same sentence is stored against the product and sent back, but the status now carries
    // it: a 500 body is replaced by a generic line before the owner ever sees it.
    const message = friendlyAiErrorMessage(error, 'Unknown error generating image.', 'image');
    await updateRow('catalog_products', catalogId, { image_status: 'failed', generation_error: message }).catch(() => {});
    return aiFailureResponse(error, 'Unknown error generating image.', 'image');
  }
}
