import { checkCompanyAccess } from '@/lib/auth/dal';
import { dbErrorMessage, listChequeBooks, listCheques } from '@/lib/db';
import { nextLeaf } from '@/lib/cheques';

export const dynamic = 'force-dynamic';

/** The next unused leaf in a bank account's cheque books, for the "paid by cheque" choice on every
 *  payment screen, whoever is using it. Null when no book is recorded or every leaf is used. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const companyId = params.get('companyId') ?? '';
  const accountId = params.get('accountId') ?? '';
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  try {
    const [books, cheques] = await Promise.all([listChequeBooks(companyId), listCheques(companyId)]);
    return Response.json({ next: accountId ? nextLeaf(books, cheques, accountId) : null }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('GET /api/cheques/next failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'The next cheque number could not be worked out.') }, { status: 500 });
  }
}
