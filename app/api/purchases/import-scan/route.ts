import { findPurchaseByFileHash } from '@/lib/db';
import { aiErrorResponse, generateJson } from '@/lib/ai/generate';
import { AiUnavailableError } from '@/lib/ai/errors';

export const dynamic = 'force-dynamic';
// Reading a document is the slowest AI call in the app — the layer allows a provider 45s for an
// attachment before failing over. Without this the platform's own default could cut the function
// off first, turning a slow-but-working scan into an unexplained failure.
export const maxDuration = 60;

const NULLABLE_STRING = { anyOf: [{ type: 'string' }, { type: 'null' }] };

const SCAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    supplier_name: { ...NULLABLE_STRING, description: 'The supplier/vendor company name as printed on the document. Null if not legible.' },
    supplier_gstin: { ...NULLABLE_STRING, description: 'The supplier/vendor’s own GSTIN (15-character GST registration number, e.g. 04AAUPG7442A1ZT) as printed on the document — not the buyer’s GSTIN. Null if not present or not legible.' },
    po_date: { ...NULLABLE_STRING, description: 'Invoice or order date in YYYY-MM-DD format. Null if not present.' },
    expected_delivery: { ...NULLABLE_STRING, description: 'Expected delivery date in YYYY-MM-DD format, if stated. Null otherwise.' },
    items: {
      type: 'array',
      description: 'Only the actual line items being ordered/billed. Never include letterhead text, terms and conditions, bank details, or signatures.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          description: { type: 'string', description: 'The item description as printed, without the part/OEM number when those appear in their own columns.' },
          quantity: { type: 'number' },
          unit_price: { type: 'number' },
          // These identify the part far more reliably than its description does: two suppliers
          // will write the same physical part under different names, but the number stays put.
          part_number: { ...NULLABLE_STRING, description: 'The supplier’s part/catalogue/item code for this line, as printed — often in its own column headed Part No, Item Code, Cat No, or printed alongside the description. Null if the document does not show one for this line.' },
          oem_number: { ...NULLABLE_STRING, description: 'The OEM / original-equipment number for this line, if the document prints one separately from the supplier’s own part number. Null otherwise.' },
          brand: { ...NULLABLE_STRING, description: 'The manufacturer or brand named on this specific line (e.g. Bosch, Tata, JCB). Null if the line does not name one — never infer it from the supplier’s own company name.' },
          hsn_code: { ...NULLABLE_STRING, description: 'The HSN/SAC code printed for this line. Null if not shown.' },
        },
        required: ['description', 'quantity', 'unit_price', 'part_number', 'oem_number', 'brand', 'hsn_code'],
      },
    },
  },
  required: ['supplier_name', 'supplier_gstin', 'po_date', 'expected_delivery', 'items'],
};

const SYSTEM_PROMPT =
  'You are extracting structured purchase order / supplier invoice data from a scanned document or photo for an auto spare ' +
  'parts trading ERP. Extract ONLY what is clearly legible and relevant: the supplier name, the supplier’s own GSTIN (not ' +
  'the buyer’s), the order/invoice date, the expected delivery date if stated, and the line items actually being ordered ' +
  'or billed (description, quantity, unit price). For every line item also capture the part/item code, OEM number, brand and ' +
  'HSN code when the document actually prints them — these are what let the ERP recognise a part it already stocks even when ' +
  'this supplier names it differently, so read the line’s own columns carefully. Never guess one: a wrong part number is far ' +
  'worse than a null. Do not extract or fabricate letterhead boilerplate, terms and conditions, ' +
  'bank/payment details, signatures, stamps, or any text unrelated to the order. If a field is not clearly present or ' +
  'legible, return null for it rather than guessing. Never invent a number or item that is not actually visible in the document.';

export async function POST(request: Request) {
  // Kept in scope for the catch block, which gives PDFs their own advice — they are the one
  // file type with no backup provider to fall back to.
  let mimeType = '';

  try {
    const body = await request.json();
    const { base64, fileHash, companyId } = body;
    mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
    if (!base64 || !mimeType) {
      return Response.json({ error: 'Missing file data.' }, { status: 400 });
    }

    // Checked before spending an AI call: the exact same file already recorded as a purchase
    // can't be scanned again either, not just re-recorded — cheaper and faster to reject here.
    if (fileHash && companyId) {
      const existingPoId = await findPurchaseByFileHash(companyId, fileHash);
      if (existingPoId) {
        return Response.json(
          { error: `This exact invoice file has already been recorded as purchase ${existingPoId} — it cannot be scanned or recorded again.` },
          { status: 409 }
        );
      }
    }

    // A photographed invoice can fall back to the backup provider; a PDF cannot — only Gemini
    // reads those — so a PDF scan while Gemini is down fails with the message below rather than
    // silently producing nothing.
    const { data } = await generateJson({
      system: SYSTEM_PROMPT,
      prompt: 'Extract the purchase order / supplier invoice details from this document.',
      schema: SCAN_JSON_SCHEMA,
      schemaName: 'purchase_document',
      attachments: [{ base64, mimeType }],
    });

    return Response.json(data);
  } catch (error) {
    console.error('purchases/import-scan failed:', error);
    if (mimeType === 'application/pdf' && error instanceof AiUnavailableError) {
      return Response.json(
        {
          error:
            'Scanning a PDF needs Google’s AI, which is unavailable right now. Take a photo of the invoice ' +
            'and scan that instead — photos use the backup service — or try the PDF again in a few minutes.',
        },
        { status: 503 }
      );
    }
    return aiErrorResponse(error, 'Unknown error scanning document.');
  }
}
