import { checkCompanyAccess } from '@/lib/auth/dal';
import { dbErrorMessage } from '@/lib/db';
import { ensureInvoicePdf } from '@/lib/invoice-archive';

export const dynamic = 'force-dynamic';

/**
 * An invoice's saved PDF, opened in the browser — on a phone, a tablet or another computer, from
 * any device signed in to the ERP.
 *
 * Brought up to date before it is served: if the invoice changed since its PDF was saved (a
 * payment, an edit, a write-off), it is redrawn and saved again first, so what opens is always
 * what the invoice says now. `?info=1` answers with the saved file's size and date instead.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const companyId = params.get('companyId') ?? '';
  const invoiceId = params.get('invoiceId') ?? '';
  const infoOnly = params.get('info') === '1';
  if (!companyId || !invoiceId) {
    return Response.json({ error: 'companyId and invoiceId are required.' }, { status: 400 });
  }
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  try {
    const pdf = await ensureInvoicePdf(companyId, invoiceId, { needBytes: !infoOnly });
    if (!pdf) return Response.json({ error: 'That invoice is not in this company.' }, { status: 404 });
    if (infoOnly) return Response.json({ size_bytes: pdf.sizeBytes, saved_at: pdf.savedAt });

    const bytes = pdf.bytes ?? new Uint8Array();
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const filename = invoiceId.replace(/[^A-Za-z0-9_-]/g, '') || 'invoice';
    return new Response(body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}.pdf"`,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('GET /api/sales/invoice-pdf failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'The invoice PDF could not be opened.') }, { status: 500 });
  }
}
