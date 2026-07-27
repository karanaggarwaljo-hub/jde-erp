import { GoogleGenAI, createUserContent, createPartFromBase64 } from '@google/genai';

export const dynamic = 'force-dynamic';

const NULLABLE_STRING = { anyOf: [{ type: 'string' }, { type: 'null' }] };

const SCAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    supplier_name: { ...NULLABLE_STRING, description: 'The supplier/vendor company name as printed on the document. Null if not legible.' },
    po_date: { ...NULLABLE_STRING, description: 'Invoice or order date in YYYY-MM-DD format. Null if not present.' },
    expected_delivery: { ...NULLABLE_STRING, description: 'Expected delivery date in YYYY-MM-DD format, if stated. Null otherwise.' },
    items: {
      type: 'array',
      description: 'Only the actual line items being ordered/billed. Never include letterhead text, terms and conditions, bank details, or signatures.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          description: { type: 'string' },
          quantity: { type: 'number' },
          unit_price: { type: 'number' },
        },
        required: ['description', 'quantity', 'unit_price'],
      },
    },
  },
  required: ['supplier_name', 'po_date', 'expected_delivery', 'items'],
};

const SYSTEM_PROMPT =
  'You are extracting structured purchase order / supplier invoice data from a scanned document or photo for an auto spare ' +
  'parts trading ERP. Extract ONLY what is clearly legible and relevant: the supplier name, the order/invoice date, the ' +
  'expected delivery date if stated, and the line items actually being ordered or billed (description, quantity, unit price). ' +
  'Do not extract or fabricate letterhead boilerplate, terms and conditions, bank/payment details, signatures, stamps, or any ' +
  'text unrelated to the order. If a field is not clearly present or legible, return null for it rather than guessing. ' +
  'Never invent a number or item that is not actually visible in the document.';

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'GEMINI_API_KEY is not configured. Add it to .env.local and restart the dev server.' },
      { status: 501 }
    );
  }

  try {
    const { base64, mimeType } = await request.json();
    if (!base64 || !mimeType) {
      return Response.json({ error: 'Missing file data.' }, { status: 400 });
    }

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
      contents: createUserContent([
        'Extract the purchase order / supplier invoice details from this document.',
        createPartFromBase64(base64, mimeType),
      ]),
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseJsonSchema: SCAN_JSON_SCHEMA,
      },
    });

    if (response.promptFeedback?.blockReason) {
      return Response.json({ error: `Gemini declined to process this file (${response.promptFeedback.blockReason}).` }, { status: 502 });
    }

    const text = response.text;
    if (!text) {
      return Response.json({ error: 'AI provider returned an empty response.' }, { status: 502 });
    }

    return Response.json(JSON.parse(text));
  } catch (error) {
    console.error('purchases/import-scan failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error scanning document.';
    return Response.json({ error: message }, { status: 500 });
  }
}
