import { dbErrorMessage } from '@/lib/db';
import { companiesOpenTo, resolveRequestCompanyId } from '@/lib/company-context';

export const dynamic = 'force-dynamic';

/**
 * The company this person is working in, and the ones they may switch to.
 *
 * Both are per person now. This used to read a single installation-wide flag from the database and
 * return every company in the project to anybody logged in — so a staff member saw companies they
 * could not open, and one person switching changed which company everybody else was working in.
 */
export async function GET() {
  try {
    const [activeId, companies] = await Promise.all([resolveRequestCompanyId(), companiesOpenTo()]);
    const active = companies.find((company) => company.id === activeId) ?? companies[0] ?? null;
    return Response.json({ active, companies });
  } catch (error) {
    console.error('GET /api/companies/active failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Failed to load company data.') }, { status: 500 });
  }
}
