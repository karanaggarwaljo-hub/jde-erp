import { dbErrorMessage, isCompanyScoped, isKnownTable, updateRow, deleteRow, deleteCompany } from '@/lib/db';
import { requireOwnCompanyRow } from '@/lib/auth/dal';

export const dynamic = 'force-dynamic';

// See app/api/local/[table]/route.ts for why these two are read-only through this generic path.
const PAYMENT_TABLES = new Set(['payments_received', 'payment_allocations']);

export async function PATCH(request: Request, { params }: { params: Promise<{ table: string; id: string }> }) {
  const { table, id } = await params;
  if (!isKnownTable(table)) {
    return Response.json({ error: `Unknown table: ${table}` }, { status: 404 });
  }
  if (PAYMENT_TABLES.has(table)) {
    return Response.json({ error: 'A recorded payment cannot be edited — delete it and record it again if it was wrong.' }, { status: 403 });
  }
  const decodedId = decodeURIComponent(id);
  // This route only ever received a bare row id, with nothing to check it against — any active
  // login could edit any row of any table belonging to any company. Looks up which company the
  // row actually belongs to and compares it to the caller's own before allowing the write.
  if (isCompanyScoped(table)) {
    const access = await requireOwnCompanyRow(table, decodedId);
    if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  }
  try {
    const patch = await request.json();
    // A generic edit is never how this app moves a row between companies — that would need its
    // own deliberate, audited flow, not a side effect of whatever a patch body happens to carry.
    delete patch.company_id;
    const row = await updateRow(table, decodedId, patch);
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
  if (PAYMENT_TABLES.has(table)) {
    return Response.json({ error: 'Delete a payment through Sales, not this endpoint — that also puts its invoices back to how they were.' }, { status: 403 });
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

    // Same gap as PATCH above: a bare row id, nothing to check it against, so any active login
    // could delete any row of any company.
    if (isCompanyScoped(table)) {
      const access = await requireOwnCompanyRow(table, decodedId);
      if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
    }

    await deleteRow(table, decodedId);
    return Response.json({ ok: true });
  } catch (error) {
    console.error(`DELETE /api/local/${table}/${id} failed:`, error);
    return Response.json({ error: dbErrorMessage(error, 'Failed to delete record.') }, { status: 500 });
  }
}
