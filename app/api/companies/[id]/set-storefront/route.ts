import { setStorefrontCompany } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = await setStorefrontCompany(decodeURIComponent(id));
  if (!company) {
    return Response.json({ error: 'Company not found.' }, { status: 404 });
  }
  return Response.json(company);
}
