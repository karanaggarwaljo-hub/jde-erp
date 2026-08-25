import { adjustRow, dbErrorMessage, type AdjustableTable } from '@/lib/db';
import { requireOwnCompanyRow } from '@/lib/auth/dal';

export const dynamic = 'force-dynamic';

const ADJUSTABLE_TABLES: AdjustableTable[] = ['products', 'customers', 'suppliers'];

function isAdjustableTable(table: string): table is AdjustableTable {
  return (ADJUSTABLE_TABLES as string[]).includes(table);
}

export async function POST(request: Request, { params }: { params: Promise<{ table: string; id: string }> }) {
  const { table, id } = await params;
  if (!isAdjustableTable(table)) {
    return Response.json({ error: `Table ${table} does not support atomic adjustment` }, { status: 404 });
  }
  const decodedId = decodeURIComponent(id);
  const { delta } = await request.json();
  if (typeof delta !== 'number' || !Number.isFinite(delta)) {
    return Response.json({ error: 'delta must be a finite number' }, { status: 400 });
  }
  // Directly moves stock or a balance number given only an id — no company_id ever came with
  // this request to check, so the target row's own company has to be looked up first.
  const access = await requireOwnCompanyRow(table, decodedId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  try {
    const row = await adjustRow(table, decodedId, delta);
    return Response.json(row);
  } catch (error) {
    console.error(`POST /api/adjust/${table}/${id} failed:`, error);
    return Response.json({ error: dbErrorMessage(error, 'Failed to adjust record.') }, { status: 500 });
  }
}
