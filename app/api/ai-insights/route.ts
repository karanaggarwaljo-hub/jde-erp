import { GoogleGenAI } from '@google/genai';
import { buildBusinessDigest } from '@/lib/ai/digest';

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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'GEMINI_API_KEY is not configured. Add it to .env.local and restart the dev server.' },
      { status: 501 }
    );
  }

  try {
    const digest = await buildBusinessDigest();
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
      contents: `Business data digest:\n${JSON.stringify(digest)}`,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseJsonSchema: INSIGHTS_JSON_SCHEMA,
      },
    });

    if (response.promptFeedback?.blockReason) {
      return Response.json({ error: `Gemini declined to analyze this data (${response.promptFeedback.blockReason}).` }, { status: 502 });
    }

    const text = response.text;
    if (!text) {
      return Response.json({ error: 'AI provider returned an empty response.' }, { status: 502 });
    }

    return Response.json({ insights: JSON.parse(text), digest });
  } catch (error) {
    console.error('ai-insights route failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error generating insights.';
    return Response.json({ error: message }, { status: 500 });
  }
}
