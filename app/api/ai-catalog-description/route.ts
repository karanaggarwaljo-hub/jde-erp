import { GoogleGenAI } from '@google/genai';
import { friendlyAiErrorMessage } from '@/lib/ai/friendly-error';

export const dynamic = 'force-dynamic';

const DESCRIPTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', description: 'A clean, customer-facing product title built from the approved name/brand/part number given. No invented model years or claims.' },
    short_description: { type: 'string', description: 'One to two plain sentences describing what the part is, using only the approved fields given.' },
    key_features: { type: 'array', items: { type: 'string' }, description: 'Short factual bullet points derived only from the approved fields given (e.g. category, brand). Empty array if nothing beyond the basics can be said honestly.' },
    compatible_machines: { type: 'array', items: { type: 'string' }, description: 'Copied/split from the approved compatibility text given, never expanded or guessed beyond it. Empty array if compatibility was not provided.' },
    search_keywords: { type: 'array', items: { type: 'string' }, description: 'Search terms a buyer might use — part number, OEM number, brand, category, common synonyms. No invented terms unrelated to the given data.' },
    warnings: { type: 'array', items: { type: 'string' }, description: 'Only include a warning if the approved data itself implies one worth surfacing (e.g. compatibility is very narrow). Usually empty.' },
  },
  required: ['title', 'short_description', 'key_features', 'compatible_machines', 'search_keywords', 'warnings'],
};

const SYSTEM_PROMPT =
  'You write website catalog descriptions for an Indian auto/heavy-machinery spare parts trading business, from approved ' +
  'ERP product data only. Never invent or imply OEM status, fitment guarantees, warranty terms, safety claims, technical ' +
  'specifications, stock levels, discounts, or brand affiliation that is not explicitly present in the fields you are given. ' +
  'If a field was not provided, leave the corresponding output empty rather than guessing. This copy will be shown to real ' +
  'customers, so accuracy matters more than sounding impressive.';

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'GEMINI_API_KEY is not configured. Add it to .env.local and restart the dev server.' },
      { status: 501 }
    );
  }

  const { name, part_number, oem_number, brand, category, compatibility } = await request.json();
  if (typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const contents = [
      `Product name: ${name}`,
      part_number ? `Part number: ${part_number}` : null,
      oem_number ? `OEM number: ${oem_number}` : null,
      brand ? `Brand: ${brand}` : null,
      category ? `Category: ${category}` : null,
      compatibility ? `Compatibility (approved, do not expand): ${compatibility}` : null,
    ].filter(Boolean).join('\n');

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseJsonSchema: DESCRIPTION_JSON_SCHEMA,
      },
    });

    if (response.promptFeedback?.blockReason) {
      return Response.json({ error: `Gemini declined to draft a description (${response.promptFeedback.blockReason}).` }, { status: 502 });
    }

    const text = response.text;
    if (!text) {
      return Response.json({ error: 'AI provider returned an empty response.' }, { status: 502 });
    }

    return Response.json(JSON.parse(text));
  } catch (error) {
    console.error('ai-catalog-description route failed:', error);
    const message = friendlyAiErrorMessage(error, 'Unknown error drafting description.');
    return Response.json({ error: message }, { status: 500 });
  }
}
