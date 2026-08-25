import { GoogleGenAI } from '@google/genai';
import { DEFAULT_GEMINI_MODEL } from '@/lib/ai/providers/gemini';
import { friendlyAiErrorMessage } from '@/lib/ai/friendly-error';

export const dynamic = 'force-dynamic';
// The AI layer may legitimately spend ~25s on a slow provider before its own fallback
// resolves; without this the platform could cut the function off first and turn a
// recoverable slow call into an unexplained failure.
export const maxDuration = 60;

type Candidate = { kind: 'image' | 'web'; url: string; sourceUrl?: string; title: string; domain: string };

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'GEMINI_API_KEY is not configured. Add it to .env.local and restart the dev server.' },
      { status: 501 }
    );
  }

  const { name, part_number, oem_number, brand, category } = await request.json();
  if (typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }

  const query = [name, brand, part_number, oem_number, category].filter((v) => typeof v === 'string' && v.trim()).join(' ');

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      contents:
        `Find reference product photos and catalog/spec pages for this spare part, for VISUAL GUIDANCE ONLY — ` +
        `these will never be downloaded, reused, or published, only linked to a human reviewer as reference: ${query}. ` +
        `Prefer manufacturer sites and reputable auto/heavy-machinery parts catalogs over generic marketplaces.`,
      config: {
        tools: [{ googleSearch: { searchTypes: { webSearch: {}, imageSearch: {} } } }],
      },
    });

    if (response.promptFeedback?.blockReason) {
      return Response.json({ error: `Gemini declined this search (${response.promptFeedback.blockReason}).` }, { status: 502 });
    }

    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const candidates: Candidate[] = [];
    for (const chunk of chunks) {
      if (chunk.image?.imageUri) {
        candidates.push({
          kind: 'image',
          url: chunk.image.imageUri,
          sourceUrl: chunk.image.sourceUri,
          title: chunk.image.title || '',
          domain: chunk.image.domain || '',
        });
      } else if (chunk.web?.uri) {
        candidates.push({ kind: 'web', url: chunk.web.uri, title: chunk.web.title || '', domain: chunk.web.domain || '' });
      }
    }

    return Response.json({ query, candidates });
  } catch (error) {
    console.error('ai-catalog-reference-search route failed:', error);
    const message = friendlyAiErrorMessage(error, 'Unknown error searching for references.');
    return Response.json({ error: message }, { status: 500 });
  }
}
