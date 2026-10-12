import { setStorefrontCompany } from '@/lib/db';
import { recordAudit } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = await setStorefrontCompany(decodeURIComponent(id));
  if (!company) {
    return Response.json({ error: 'Company not found.' }, { status: 404 });
  }
  await recordAudit({
    companyId: String(company.id ?? decodeURIComponent(id)), action: 'company.storefront', entity: 'companies', entityId: String(company.id ?? ''),
    summary: `Made ${String(company.name ?? 'this company')} the company shown on the public website`,
  });
  return Response.json(company);
}
