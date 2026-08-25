import { aiErrorResponse, generateJson } from '@/lib/ai/generate';

export const dynamic = 'force-dynamic';
// The AI layer may legitimately spend ~25s on a slow provider before its own fallback
// resolves; without this the platform could cut the function off first and turn a
// recoverable slow call into an unexplained failure.
export const maxDuration = 60;

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
  const { reportType, data } = await request.json();
  const label = REPORT_LABELS[reportType];
  if (!label) {
    return Response.json({ error: `Unknown reportType: ${reportType}` }, { status: 400 });
  }
  if (typeof data !== 'object' || data === null) {
    return Response.json({ error: 'data is required' }, { status: 400 });
  }

  try {
    const { data: summary } = await generateJson({
      system: SYSTEM_PROMPT,
      prompt: `Report: ${label}\nData:\n${JSON.stringify(data)}`,
      schema: SUMMARY_JSON_SCHEMA,
      schemaName: 'report_summary',
    });

    return Response.json(summary);
  } catch (error) {
    console.error('ai-report-summary route failed:', error);
    return aiErrorResponse(error, 'Unknown error generating summary.');
  }
}
