import { GoogleGenAI } from '@google/genai';
import { buildDailyBriefingDigest } from '@/lib/ai/digest';

export const dynamic = 'force-dynamic';

const BRIEFING_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    priorities: {
      type: 'array',
      minItems: 0,
      maxItems: 3,
      description: 'The most important things to act on today, ranked by financial or operational impact. Only include a priority if the digest actually has data for it.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['collect_receivable', 'pay_supplier', 'restock', 'sales_note'] },
          title: { type: 'string', description: 'Short label, e.g. "Collect outstanding from 2 customers".' },
          detail: { type: 'string', description: 'One or two sentences citing the exact figures from the digest. Never invent a number not present in the digest.' },
          impact_amount: { type: 'number', description: 'The rupee amount this priority is worth, taken directly from the digest. 0 if not money-related.' },
          action_label: { type: 'string', description: 'Label for the button, e.g. "Review receivables".' },
          action_href: { type: 'string', enum: ['/customers', '/suppliers', '/inventory', '/sales'] },
        },
        required: ['type', 'title', 'detail', 'impact_amount', 'action_label', 'action_href'],
      },
    },
  },
  required: ['priorities'],
};

const SYSTEM_PROMPT =
  'You are the daily briefing generator for an auto spare parts trading ERP (Jai Durga Enterprises). ' +
  'You are given a JSON digest of deterministic figures already computed by the ERP: outstanding customer receivables, ' +
  'outstanding supplier payables, low-stock items, and yesterday\'s sales total. ' +
  'Pick at most 3 priorities, ranked by impact, and write a short explanation for each that cites only figures present in the digest. ' +
  'Never invent a number, customer, supplier, or product that is not in the digest. If a category has zero items, do not create a priority for it. ' +
  'If everything is empty, return an empty priorities array. Currency is INR (₹).';

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'GEMINI_API_KEY is not configured. Add it to .env.local and restart the dev server.' },
      { status: 501 }
    );
  }

  try {
    const digest = await buildDailyBriefingDigest();
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
      contents: `Daily digest:\n${JSON.stringify(digest)}`,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseJsonSchema: BRIEFING_JSON_SCHEMA,
      },
    });

    if (response.promptFeedback?.blockReason) {
      return Response.json({ error: `Gemini declined to generate the briefing (${response.promptFeedback.blockReason}).` }, { status: 502 });
    }

    const text = response.text;
    if (!text) {
      return Response.json({ error: 'AI provider returned an empty response.' }, { status: 502 });
    }

    return Response.json({ briefing: JSON.parse(text), digest });
  } catch (error) {
    console.error('daily-briefing route failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error generating briefing.';
    return Response.json({ error: message }, { status: 500 });
  }
}
