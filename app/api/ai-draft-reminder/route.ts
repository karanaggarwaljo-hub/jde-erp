import { GoogleGenAI } from '@google/genai';
import { friendlyAiErrorMessage } from '@/lib/ai/friendly-error';

export const dynamic = 'force-dynamic';

const REMINDER_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    message: { type: 'string', description: 'The ready-to-send follow-up message, under 80 words.' },
  },
  required: ['message'],
};

const SYSTEM_PROMPT =
  'You draft short, polite payment follow-up messages for an Indian auto spare parts trading business (Jai Durga Enterprises), ' +
  'suitable for sending as-is over WhatsApp or SMS. Keep it under 80 words, friendly but clear about the amount and what you need ' +
  'from the recipient. Currency is INR (₹). Do not invent details (dates, invoice numbers, contact names) beyond what is given to you.';

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'GEMINI_API_KEY is not configured. Add it to .env.local and restart the dev server.' },
      { status: 501 }
    );
  }

  const { direction, name, balance, context } = await request.json();
  if (direction !== 'receivable' && direction !== 'payable') {
    return Response.json({ error: 'direction must be "receivable" or "payable"' }, { status: 400 });
  }
  if (typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }
  if (typeof balance !== 'number' || Number.isNaN(balance)) {
    return Response.json({ error: 'balance must be a number' }, { status: 400 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const situation =
      direction === 'receivable'
        ? `Draft a payment reminder to SEND TO a customer named "${name}" who currently owes this business ₹${balance.toLocaleString('en-IN')}. Politely ask them to clear it.`
        : `Draft a payment follow-up message to SEND TO a supplier named "${name}" that this business currently owes ₹${balance.toLocaleString('en-IN')} to. Let them know the status / when it will be settled, or ask for their latest statement if unclear.`;

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
      contents: `${situation}${context ? `\nAdditional context: ${context}` : ''}`,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseJsonSchema: REMINDER_JSON_SCHEMA,
      },
    });

    if (response.promptFeedback?.blockReason) {
      return Response.json({ error: `Gemini declined to draft this message (${response.promptFeedback.blockReason}).` }, { status: 502 });
    }

    const text = response.text;
    if (!text) {
      return Response.json({ error: 'AI provider returned an empty response.' }, { status: 502 });
    }

    return Response.json(JSON.parse(text));
  } catch (error) {
    console.error('ai-draft-reminder route failed:', error);
    const message = friendlyAiErrorMessage(error, 'Unknown error drafting message.');
    return Response.json({ error: message }, { status: 500 });
  }
}
