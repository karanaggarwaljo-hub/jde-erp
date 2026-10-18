import { checkCompanyAccess } from '@/lib/auth/dal';
import { ensureMoneyAccounts } from '@/lib/cash-book';
import { dbErrorMessage } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** The company's cash and bank accounts — names and kinds only, never balances — for the "paid
 *  by / into" choice on every screen that takes or pays money, whoever is using it. Balances are
 *  on the owner-only Cash & Bank page. */
export async function GET(request: Request) {
  const companyId = new URL(request.url).searchParams.get('companyId') ?? '';
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  try {
    const accounts = await ensureMoneyAccounts(companyId);
    return Response.json(accounts.filter((account) => !account.archived).map(({ id, name, kind }) => ({ id, name, kind })));
  } catch (error) {
    console.error('GET /api/money/accounts failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'The accounts could not be loaded.') }, { status: 500 });
  }
}
