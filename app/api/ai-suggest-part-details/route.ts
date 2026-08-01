import { GoogleGenAI } from '@google/genai';
import { friendlyAiErrorMessage } from '@/lib/ai/friendly-error';

export const dynamic = 'force-dynamic';

const SUGGESTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: { type: 'string', description: 'Best-fit category for this part. Prefer one of the existing categories given; propose a short new one only if none fit.' },
    brand: { type: 'string', description: 'The manufacturer/brand, ONLY if it is actually stated or clearly implied in the name/OEM number given. Empty string if not — never guess a plausible-sounding brand.' },
  },
  required: ['category', 'brand'],
};

const SYSTEM_PROMPT =
  'You help catalog spare parts for an Indian auto parts trading business. Given a part name and optionally an OEM ' +
  'number, suggest a category and a brand. Categories describe the TYPE of part (e.g. Brakes, Filters, Engine, Electrical), ' +
  'not the vehicle it fits and not the manufacturer. Only fill in "brand" if the manufacturer is actually named or clearly ' +
  'implied in the text you were given — leave it as an empty string rather than guessing one, since a wrong brand on a real ' +
  'part listing is worse than a blank field. Never suggest or infer vehicle compatibility — that is out of scope here.';

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'GEMINI_API_KEY is not configured. Add it to .env.local and restart the dev server.' },
      { status: 501 }
    );
  }

  const { name, oem_number, existingCategories } = await request.json();
  if (typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const categoriesLine = Array.isArray(existingCategories) && existingCategories.length > 0
      ? `Existing categories already used in this catalog: ${existingCategories.join(', ')}.`
      : '';
    const contents = [
      `Part name: "${name}"`,
      oem_number ? `OEM number: "${oem_number}"` : null,
      categoriesLine || null,
    ].filter(Boolean).join('\n');

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseJsonSchema: SUGGESTION_JSON_SCHEMA,
      },
    });

    if (response.promptFeedback?.blockReason) {
      return Response.json({ error: `Gemini declined to suggest details (${response.promptFeedback.blockReason}).` }, { status: 502 });
    }

    const text = response.text;
    if (!text) {
      return Response.json({ error: 'AI provider returned an empty response.' }, { status: 502 });
    }

    return Response.json(JSON.parse(text));
  } catch (error) {
    console.error('ai-suggest-part-details route failed:', error);
    const message = friendlyAiErrorMessage(error, 'Unknown error suggesting part details.');
    return Response.json({ error: message }, { status: 500 });
  }
}
