import { dbErrorMessage, getActiveCompanyId, listRows } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const activeId = await getActiveCompanyId();
    const companies = await listRows('companies');
    const active = companies.find((c) => c.id === activeId) ?? null;
    return Response.json({ active, companies });
  } catch (error) {
    console.error('GET /api/companies/active failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Failed to load company data.') }, { status: 500 });
  }
}
