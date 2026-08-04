import { adjustRow, dbErrorMessage, type AdjustableTable } from '@/lib/db';

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
  const { delta } = await request.json();
  if (typeof delta !== 'number' || Number.isNaN(delta)) {
    return Response.json({ error: 'delta must be a number' }, { status: 400 });
  }
  try {
    const row = await adjustRow(table, decodeURIComponent(id), delta);
    return Response.json(row);
  } catch (error) {
    console.error(`POST /api/adjust/${table}/${id} failed:`, error);
    return Response.json({ error: dbErrorMessage(error, 'Failed to adjust record.') }, { status: 500 });
  }
}
