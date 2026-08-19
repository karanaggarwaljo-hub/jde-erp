import { buildBusinessDigest } from '@/lib/ai/digest';
import { aiErrorResponse, generateJson } from '@/lib/ai/generate';

export const dynamic = 'force-dynamic';

const INSIGHTS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headline: { type: 'string', description: 'One-sentence takeaway on business health right now.' },
    data_confidence: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
      description: 'low if most transactional tables are empty or cover a very short history.',
    },
    key_trends: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string' },
          detail: { type: 'string' },
          direction: { type: 'string', enum: ['up', 'down', 'flat'] },
        },
        required: ['label', 'detail', 'direction'],
      },
    },
    forecast: {
      type: 'object',
      additionalProperties: false,
      properties: {
        horizon: { type: 'string', description: 'e.g. "next 30 days"' },
        narrative: { type: 'string' },
      },
      required: ['horizon', 'narrative'],
    },
    risks: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['title', 'detail', 'severity'],
      },
    },
    recommendations: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['action', 'reason'],
      },
    },
  },
  required: ['headline', 'data_confidence', 'key_trends', 'forecast', 'risks', 'recommendations'],
};

const SYSTEM_PROMPT =
  'You are a financial and operations analyst for an auto spare parts trading ERP (Jai Durga Enterprises). ' +
  'You are given a JSON digest aggregated from the live database. Analyze it and produce trends, a short-term forecast, ' +
  'risks, and concrete recommended actions. If a section of the data is empty or the history window is short, say so plainly ' +
  'in data_confidence and avoid inventing numbers that are not derivable from the digest. Currency is INR (₹).';

export async function GET() {
  try {
    const digest = await buildBusinessDigest();
    const { data, provider } = await generateJson({
      system: SYSTEM_PROMPT,
      prompt: `Business data digest:\n${JSON.stringify(digest)}`,
      schema: INSIGHTS_JSON_SCHEMA,
      schemaName: 'business_insights',
    });

    return Response.json({ insights: data, digest, provider });
  } catch (error) {
    console.error('ai-insights route failed:', error);
    return aiErrorResponse(error, 'Unknown error generating insights.');
  }
}
