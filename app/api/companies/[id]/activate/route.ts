import { dbErrorMessage } from '@/lib/db';
import { chooseCompany, companiesOpenTo } from '@/lib/company-context';

export const dynamic = 'force-dynamic';

/**
 * Switches which company THIS person is working in, for their browser only.
 *
 * It used to flip `jde_companies.is_active`, a single row for the whole installation, so one
 * person switching moved everybody else too — including somebody halfway through entering an
 * invoice, which would then have been saved against a different company's books. The flag is left
 * alone now; it survives only as the starting point for a session that has never chosen.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = decodeURIComponent(id);

  try {
    if (!await chooseCompany(companyId)) {
      // Deliberately the same answer whether the company does not exist or this person may not
      // open it: which other companies exist is not something a staff login needs to learn.
      return Response.json({ error: 'That company is not available to you.' }, { status: 403 });
    }
    const companies = await companiesOpenTo();
    return Response.json(companies.find((company) => company.id === companyId) ?? { id: companyId });
  } catch (error) {
    console.error(`POST /api/companies/${companyId}/activate failed:`, error);
    return Response.json({ error: dbErrorMessage(error, 'Could not switch company.') }, { status: 500 });
  }
}
