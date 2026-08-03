import { GoogleGenAI } from '@google/genai';
import { friendlyAiErrorMessage } from '@/lib/ai/friendly-error';
import { updateRow, uploadCatalogImage } from '@/lib/db';

export const dynamic = 'force-dynamic';

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

  const { catalogId, prompt } = await request.json();
  if (typeof catalogId !== 'string' || !catalogId) {
    return Response.json({ error: 'catalogId is required' }, { status: 400 });
  }
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return Response.json({ error: 'prompt is required' }, { status: 400 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    // The dedicated Imagen models/generateImages() API is being retired (shutting down
    // 2026-08-17) — Google's migration guidance is gemini-2.5-flash-image ("Nano Banana") via
    // the regular generateContent() call instead, which returns the image as an inline part
    // rather than a generatedImages[] response. Free tier, same GEMINI_API_KEY as everything else.
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
      contents: prompt,
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
