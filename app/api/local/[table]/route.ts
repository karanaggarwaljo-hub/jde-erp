import { isKnownTable, listRows, insertRow } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ table: string }> }) {
  const { table } = await params;
  if (!isKnownTable(table)) {
    return Response.json({ error: `Unknown table: ${table}` }, { status: 404 });
  }
  const companyId = new URL(request.url).searchParams.get('company_id') ?? undefined;
  return Response.json(await listRows(table, companyId));
}

export async function POST(request: Request, { params }: { params: Promise<{ table: string }> }) {
  const { table } = await params;
  if (!isKnownTable(table)) {
    return Response.json({ error: `Unknown table: ${table}` }, { status: 404 });
  }
  const body = await request.json();
  const row = await insertRow(table, body);
  return Response.json(row, { status: 201 });
}
