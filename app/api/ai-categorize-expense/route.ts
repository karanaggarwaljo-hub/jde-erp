import { GoogleGenAI } from '@google/genai';
import { friendlyAiErrorMessage } from '@/lib/ai/friendly-error';

export const dynamic = 'force-dynamic';

const CATEGORIES = ['rent', 'salaries', 'utilities', 'transport', 'maintenance', 'office', 'other'] as const;

const CATEGORY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: { type: 'string', enum: [...CATEGORIES] },
  },
  required: ['category'],
};

const SYSTEM_PROMPT =
  `You categorize operational expenses for an Indian auto spare parts trading business. Given a short free-text ` +
  `description, pick exactly one category from: ${CATEGORIES.join(', ')}. "transport" means freight/courier/delivery/fuel ` +
  `costs, "office" means stationery/office supplies/small equipment, "other" is only for genuinely ambiguous cases.`;

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'GEMINI_API_KEY is not configured. Add it to .env.local and restart the dev server.' },
      { status: 501 }
    );
  }

  const { description } = await request.json();
  if (typeof description !== 'string' || !description.trim()) {
    return Response.json({ error: 'description is required' }, { status: 400 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
      contents: `Expense description: "${description}"`,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseJsonSchema: CATEGORY_JSON_SCHEMA,
      },
    });

    if (response.promptFeedback?.blockReason) {
      return Response.json({ error: `Gemini declined to categorize this (${response.promptFeedback.blockReason}).` }, { status: 502 });
    }

    const text = response.text;
    if (!text) {
      return Response.json({ error: 'AI provider returned an empty response.' }, { status: 502 });
    }

    return Response.json(JSON.parse(text));
  } catch (error) {
    console.error('ai-categorize-expense route failed:', error);
    const message = friendlyAiErrorMessage(error, 'Unknown error categorizing expense.');
    return Response.json({ error: message }, { status: 500 });
  }
}
