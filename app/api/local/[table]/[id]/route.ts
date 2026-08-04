import { dbErrorMessage, isKnownTable, updateRow, deleteRow, deleteCompany } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ table: string; id: string }> }) {
  const { table, id } = await params;
  if (!isKnownTable(table)) {
    return Response.json({ error: `Unknown table: ${table}` }, { status: 404 });
  }
  try {
    const patch = await request.json();
    const row = await updateRow(table, decodeURIComponent(id), patch);
    if (!row) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(row);
  } catch (error) {
    console.error(`PATCH /api/local/${table}/${id} failed:`, error);
    return Response.json({ error: dbErrorMessage(error, 'Failed to update record.') }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ table: string; id: string }> }) {
  const { table, id } = await params;
  if (!isKnownTable(table)) {
    return Response.json({ error: `Unknown table: ${table}` }, { status: 404 });
  }
  const decodedId = decodeURIComponent(id);

  try {
    if (table === 'companies') {
      const result = await deleteCompany(decodedId);
      if ('error' in result) {
        return Response.json({ error: result.error }, { status: 400 });
      }
      return Response.json({ ok: true });
    }

    await deleteRow(table, decodedId);
    return Response.json({ ok: true });
  } catch (error) {
    console.error(`DELETE /api/local/${table}/${id} failed:`, error);
    return Response.json({ error: dbErrorMessage(error, 'Failed to delete record.') }, { status: 500 });
  }
}
