import { aiErrorResponse, generateJson } from '@/lib/ai/generate';
import { AiUnavailableError } from '@/lib/ai/errors';

export const dynamic = 'force-dynamic';
// Reading a document is the slowest AI call in the app — the layer allows a provider 45s for an
// attachment before failing over. Without this the platform's own default could cut the function
// off first, turning a slow-but-working scan into an unexplained failure.
export const maxDuration = 60;

const NULLABLE_STRING = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const NULLABLE_NUMBER = { anyOf: [{ type: 'number' }, { type: 'null' }] };

/** Deliberately separate from the purchase-invoice scan. That one reads a bill: a supplier, an
 *  invoice number, a date, amounts owed. This reads a LIST of parts — a stock sheet, a supplier's
 *  price list, a photo of a register page — where there may be no supplier, no date and no totals
 *  at all, and where the interesting columns are the ones Inventory actually stores. */
const LIST_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      description: 'One entry per part listed. Empty if the image shows no list of parts.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'The part name or description as written.' },
          part_number: { ...NULLABLE_STRING, description: 'The part/item/catalogue code for this row, if the list shows one. Null otherwise.' },
          oem_number: { ...NULLABLE_STRING, description: 'The OEM number, only when printed separately from the part number. Null otherwise.' },
          brand: { ...NULLABLE_STRING, description: 'Manufacturer or brand named on this row (e.g. Bosch, JCB, Tata). Null if the row does not name one.' },
          category: { ...NULLABLE_STRING, description: 'A category/group written on the row or as a heading above it (e.g. Filters, Hydraulics). Null if none is shown.' },
          hsn_code: { ...NULLABLE_STRING, description: 'HSN/SAC code for this row. Null if not shown.' },
          qty: { ...NULLABLE_NUMBER, description: 'Quantity in stock for this row, if the list shows one. Null if the list has no quantity column.' },
          cost_price: { ...NULLABLE_NUMBER, description: 'What the business pays for one unit — a cost, purchase, net, dealer or landing rate. Null if the list only shows a selling price.' },
          sale_price: { ...NULLABLE_NUMBER, description: 'What the business sells one unit for, when the list distinguishes it from cost. Null otherwise.' },
          mrp: { ...NULLABLE_NUMBER, description: 'Printed MRP / list price, if shown separately. Null otherwise.' },
        },
        required: ['name', 'part_number', 'oem_number', 'brand', 'category', 'hsn_code', 'qty', 'cost_price', 'sale_price', 'mrp'],
      },
    },
  },
  required: ['items'],
};

const SYSTEM_PROMPT =
  'You are reading a list of spare parts from a photo or scanned document for an auto spare parts ' +
  'trading ERP. It may be a supplier price list, a stock sheet, a printed catalogue page, or a ' +
  'handwritten register — not necessarily an invoice. Extract one entry per part actually listed. ' +
  'Read each row carefully and put each number under the right heading: a quantity column is not a ' +
  'price, and where a list shows both a cost and a selling price, the cost is the lower one the ' +
  'business pays. If a list shows only one price and does not say which it is, put it in cost_price ' +
  'and leave sale_price null. Return null for anything the list does not actually show — never carry ' +
  'a value across from a neighbouring row or column, and never invent a part number. Ignore ' +
  'headings, totals, page numbers, letterhead, stamps and signatures. If the image is not a list of ' +
  'parts at all, return an empty items array rather than guessing.';

export async function POST(request: Request) {
  let mimeType = '';
  try {
    const body = await request.json();
    const { base64 } = body;
    mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
    if (!base64 || !mimeType) {
      return Response.json({ error: 'Missing file data.' }, { status: 400 });
    }

    const { data } = await generateJson({
      system: SYSTEM_PROMPT,
      prompt: 'Extract every part listed in this document.',
      schema: LIST_JSON_SCHEMA,
      schemaName: 'inventory_list',
      attachments: [{ base64, mimeType }],
    });

    return Response.json(data);
  } catch (error) {
    console.error('inventory/scan-list failed:', error);
    // Only Gemini reads PDFs, so a PDF has no second provider to fall back on — say what to do
    // instead of leaving it looking like a general outage.
    if (mimeType === 'application/pdf' && error instanceof AiUnavailableError) {
      return Response.json(
        {
          error:
            'Reading a PDF needs Google’s AI, which is unavailable right now. Take a photo of the ' +
            'page and drop that instead — photos use the backup service — or try the PDF again in a few minutes.',
        },
        { status: 503 }
      );
    }
    return aiErrorResponse(error, 'Unknown error reading this document.');
  }
}
