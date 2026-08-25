import { planAiRun, recordAiRun, replayMeta } from '@/lib/ai/cache';
import { buildReorderDigest } from '@/lib/ai/digest';
import { aiErrorResponse, generateJson } from '@/lib/ai/generate';

export const dynamic = 'force-dynamic';
// The AI layer may legitimately spend ~25s on a slow provider before its own fallback
// resolves; without this the platform could cut the function off first and turn a
// recoverable slow call into an unexplained failure.
export const maxDuration = 60;

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
  'You are given a JSON digest of products with current stock, minimum stock thresholds, and cost. ' +
  'The product list has already been narrowed to those needing attention — read the "scope" field, and note that ' +
  '"active_product_count" is the size of the WHOLE catalogue while "products" is only the shortlist. Never describe the ' +
  'business as having only as many products as are listed, and never treat an omitted product as discontinued or missing. ' +
  'Recommend which products to reorder and how much. ' +
  'has_sales_velocity_data is always false in this digest — base recommendations only on current_stock vs min_stock and set confidence to "low" ' +
  '— do not invent a sales trend or a specific days-until-stockout figure you cannot derive from the digest. ' +
  'Prioritize products at or below their minimum stock. Currency is INR (₹).';

const FEATURE = 'forecast';

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get('refresh') === '1';
  const plan = await planAiRun(FEATURE, '', { force });

  // Replay costs nothing and skips building the digest entirely — on most page loads this route
  // now touches neither an AI provider nor the products table.
  if (!plan.shouldGenerate && plan.cached) {
    return Response.json({ forecast: plan.cached.payload, cache: replayMeta(plan.cached) });
  }

  try {
    const digest = await buildReorderDigest();
    const { data, provider } = await generateJson({
      system: SYSTEM_PROMPT,
      prompt: `Inventory digest:\n${JSON.stringify(digest)}`,
      schema: FORECAST_JSON_SCHEMA,
      schemaName: 'reorder_forecast',
    });

    const cache = await recordAiRun(plan, FEATURE, '', data);
    return Response.json({ forecast: data, digest, provider, cache });
  } catch (error) {
    console.error('ai-forecast route failed:', error);
    // An outage should not blank out an answer we already have. Show the stored one and say
    // plainly that refreshing it failed, rather than replacing it with a red error.
    if (plan.cached) {
      return Response.json({ forecast: plan.cached.payload, cache: { ...replayMeta(plan.cached), refresh_failed: true } });
    }
    return aiErrorResponse(error, 'Unknown error generating forecast.');
  }
}
