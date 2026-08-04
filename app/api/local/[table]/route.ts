import { dbErrorMessage, isKnownTable, listRows, insertRow } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ table: string }> }) {
  const { table } = await params;
  if (!isKnownTable(table)) {
    return Response.json({ error: `Unknown table: ${table}` }, { status: 404 });
  }
  try {
    const companyId = new URL(request.url).searchParams.get('company_id') ?? undefined;
    return Response.json(await listRows(table, companyId));
  } catch (error) {
    console.error(`GET /api/local/${table} failed:`, error);
    return Response.json({ error: dbErrorMessage(error, 'Failed to load records.') }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ table: string }> }) {
  const { table } = await params;
  if (!isKnownTable(table)) {
    return Response.json({ error: `Unknown table: ${table}` }, { status: 404 });
  }
  try {
    const body = await request.json();
    const row = await insertRow(table, body);
    return Response.json(row, { status: 201 });
  } catch (error) {
    console.error(`POST /api/local/${table} failed:`, error);
    return Response.json({ error: dbErrorMessage(error, 'Failed to create record.') }, { status: 500 });
  }
}
