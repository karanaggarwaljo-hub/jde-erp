import { GoogleGenAI, createPartFromBase64, createUserContent } from '@google/genai';
import { friendlyAiErrorMessage } from '@/lib/ai/friendly-error';
import { updateRow, uploadCatalogImage } from '@/lib/db';

export const dynamic = 'force-dynamic';

const MAX_REFERENCE_IMAGE_BYTES = 8 * 1024 * 1024;

/** Best-effort fetch of a reference image found via ai-catalog-reference-search, so it can be
 *  passed to Gemini as visual grounding instead of generating blind from text alone. Never
 *  throws — a broken/oversized/non-image link just means generation falls back to text-only,
 *  same as if no reference had been selected. The fetched bytes are used for this one request
 *  and never stored — only the newly generated image gets uploaded/published. */
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

  const { catalogId, prompt, referenceImageUrl } = await request.json();
  if (typeof catalogId !== 'string' || !catalogId) {
    return Response.json({ error: 'catalogId is required' }, { status: 400 });
  }
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return Response.json({ error: 'prompt is required' }, { status: 400 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const reference = typeof referenceImageUrl === 'string' && referenceImageUrl
      ? await fetchReferenceImageAsBase64(referenceImageUrl)
      : null;

    // The dedicated Imagen models/generateImages() API is being retired (shutting down
    // 2026-08-17) — Google's migration guidance is gemini-2.5-flash-image ("Nano Banana") via
    // the regular generateContent() call instead, which returns the image as an inline part
    // rather than a generatedImages[] response. Free tier, same GEMINI_API_KEY as everything else.
    // When a reference photo was found and picked in Reference Search, it's attached here so the
    // model has an actual visual guide for the real part's shape/proportions instead of guessing
    // from text alone — the photo itself is only ever used for this one request, never stored.
    const contents = reference
      ? createUserContent([
          `${prompt}\n\nA reference photo of a similar real part is attached below — use it as a visual guide for ` +
            'the actual shape, proportions, and material of this part. Do not copy any text, logos, watermarks, ' +
            'pricing, or background/props visible in the reference photo itself.',
          createPartFromBase64(reference.base64, reference.mimeType),
        ])
      : prompt;

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
      contents,
      // Catalog photos need a wide banner shape (1600x600, ~8:3) — 21:9 is the closest ratio
      // the API actually supports (a fixed list, no arbitrary custom ratio), paired with the
      // literal pixel target already stated in the prompt text itself for extra signal.
      config: { imageConfig: { aspectRatio: '21:9' } },
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
    const message = friendlyAiErrorMessage(error, 'Unknown error generating image.');
    await updateRow('catalog_products', catalogId, { image_status: 'failed', generation_error: message }).catch(() => {});
    return Response.json({ error: message }, { status: 500 });
  }
}
