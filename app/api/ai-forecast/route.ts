import { buildReorderDigest } from '@/lib/ai/digest';
import { aiErrorResponse, generateJson } from '@/lib/ai/generate';

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
  'You are given a JSON digest of active products with current stock, minimum stock thresholds, and cost. ' +
  'Recommend which products to reorder and how much. ' +
  'has_sales_velocity_data is always false in this digest — base recommendations only on current_stock vs min_stock and set confidence to "low" ' +
  '— do not invent a sales trend or a specific days-until-stockout figure you cannot derive from the digest. ' +
  'Prioritize products at or below their minimum stock. Currency is INR (₹).';

export async function GET() {
  try {
    const digest = await buildReorderDigest();
    const { data, provider } = await generateJson({
      system: SYSTEM_PROMPT,
      prompt: `Inventory digest:\n${JSON.stringify(digest)}`,
      schema: FORECAST_JSON_SCHEMA,
      schemaName: 'reorder_forecast',
    });

    return Response.json({ forecast: data, digest, provider });
  } catch (error) {
    console.error('ai-forecast route failed:', error);
    return aiErrorResponse(error, 'Unknown error generating forecast.');
  }
}
