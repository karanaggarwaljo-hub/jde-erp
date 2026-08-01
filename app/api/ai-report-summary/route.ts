import { GoogleGenAI } from '@google/genai';
import { friendlyAiErrorMessage } from '@/lib/ai/friendly-error';

export const dynamic = 'force-dynamic';

const SUMMARY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', description: '2-4 sentence plain-English explanation of these numbers — what stands out and why, not a restatement of the figures.' },
  },
  required: ['summary'],
};

const SYSTEM_PROMPT =
  'You explain financial reports in plain English for the owner of an Indian auto spare parts trading business ' +
  '(Jai Durga Enterprises), who is not an accountant. You are given the exact numbers already computed and shown on ' +
  'screen for one report tab, as JSON. Write a short (2-4 sentence) explanation of what these numbers mean and what, ' +
  'if anything, stands out — do not just restate the figures back, and do not invent numbers, dates, or names not present ' +
  'in the data. If the data is sparse or all-zero, say plainly that there is not enough history yet rather than inventing ' +
  'a narrative. Currency is INR (₹).';

const REPORT_LABELS: Record<string, string> = {
  pnl: 'Profit & Loss statement',
  sales: 'Sales summary',
  stock: 'Stock valuation',
  gst: 'GST summary',
  aging: 'Receivables/payables aging',
};

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'GEMINI_API_KEY is not configured. Add it to .env.local and restart the dev server.' },
      { status: 501 }
    );
  }

  const { reportType, data } = await request.json();
  const label = REPORT_LABELS[reportType];
  if (!label) {
    return Response.json({ error: `Unknown reportType: ${reportType}` }, { status: 400 });
  }
  if (typeof data !== 'object' || data === null) {
    return Response.json({ error: 'data is required' }, { status: 400 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
      contents: `Report: ${label}\nData:\n${JSON.stringify(data)}`,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseJsonSchema: SUMMARY_JSON_SCHEMA,
      },
    });

    if (response.promptFeedback?.blockReason) {
      return Response.json({ error: `Gemini declined to summarize this report (${response.promptFeedback.blockReason}).` }, { status: 502 });
    }

    const text = response.text;
    if (!text) {
      return Response.json({ error: 'AI provider returned an empty response.' }, { status: 502 });
    }

    return Response.json(JSON.parse(text));
  } catch (error) {
    console.error('ai-report-summary route failed:', error);
    const message = friendlyAiErrorMessage(error, 'Unknown error generating summary.');
    return Response.json({ error: message }, { status: 500 });
  }
}
