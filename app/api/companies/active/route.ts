import { getActiveCompanyId, listRows } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const activeId = await getActiveCompanyId();
  const companies = await listRows('companies');
  const active = companies.find((c) => c.id === activeId) ?? null;
  return Response.json({ active, companies });
}
