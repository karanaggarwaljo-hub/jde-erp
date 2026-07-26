import { GoogleGenAI } from '@google/genai';
import { buildReorderDigest } from '@/lib/ai/digest';

export const dynamic = 'force-dynamic';

const FORECAST_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headline: { type: 'string', description: 'One-sentence summary of reorder urgency across the catalog.' },
    confidence: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
      description: 'low if there is little or no sales velocity history to base a forecast on.',
    },
    items: {
      type: 'array',
      maxItems: 8,
      description: 'Products worth reordering soon, most urgent first. Empty if nothing needs attention.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          part_number: { type: 'string' },
          name: { type: 'string' },
          current_stock: { type: 'number' },
          min_stock: { type: 'number' },
          recommended_order_qty: { type: 'number' },
          urgency: { type: 'string', enum: ['low', 'medium', 'high'] },
          reason: { type: 'string' },
        },
        required: ['part_number', 'name', 'current_stock', 'min_stock', 'recommended_order_qty', 'urgency', 'reason'],
      },
    },
  },
  required: ['headline', 'confidence', 'items'],
};

const SYSTEM_PROMPT =
  'You are an inventory planner for an auto spare parts trading ERP (Jai Durga Enterprises). ' +
  'You are given a JSON digest of active products with current stock, minimum stock thresholds, cost, and units sold ' +
  'in the last 60 days (from the stock ledger). Recommend which products to reorder and how much. ' +
  'If has_sales_velocity_data is false, base recommendations only on current_stock vs min_stock and set confidence to "low" ' +
  '— do not invent a sales trend or a specific days-until-stockout figure you cannot derive from the digest. ' +
  'Prioritize products at or below their minimum stock. Currency is INR (₹).';

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'GEMINI_API_KEY is not configured. Add it to .env.local and restart the dev server.' },
      { status: 501 }
    );
  }

  try {
    const digest = await buildReorderDigest();
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
      contents: `Inventory digest:\n${JSON.stringify(digest)}`,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseJsonSchema: FORECAST_JSON_SCHEMA,
      },
    });

    if (response.promptFeedback?.blockReason) {
      return Response.json({ error: `Gemini declined to analyze this data (${response.promptFeedback.blockReason}).` }, { status: 502 });
    }

    const text = response.text;
    if (!text) {
      return Response.json({ error: 'AI provider returned an empty response.' }, { status: 502 });
    }

    return Response.json({ forecast: JSON.parse(text), digest });
  } catch (error) {
    console.error('ai-forecast route failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error generating forecast.';
    return Response.json({ error: message }, { status: 500 });
  }
}
