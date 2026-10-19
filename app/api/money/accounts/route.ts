import { checkCompanyAccess } from '@/lib/auth/dal';
import { listBanks } from '@/lib/cash-book';
import { dbErrorMessage } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** The company's banks — names only — for the "paid by cheque" choice on every screen that pays
 *  money, whoever is using it. Banks are added with a cheque book on the owner-only Cheques page. */
export async function GET(request: Request) {
  const companyId = new URL(request.url).searchParams.get('companyId') ?? '';
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  try {
    const banks = await listBanks(companyId);
    return Response.json(banks.map(({ id, name, kind }) => ({ id, name, kind })));
  } catch (error) {
    console.error('GET /api/money/accounts failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'The banks could not be loaded.') }, { status: 500 });
  }
}
