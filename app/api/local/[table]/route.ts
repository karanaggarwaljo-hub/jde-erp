import { dbErrorMessage, insertRows, isKnownTable, listRows, insertRow } from '@/lib/db';

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

// Reachable for GET (the ledger and Receive Payment screens read them) but never written to
// directly here: a raw insert would create a payment with no invoice update, no id from the
// RCPT-#### sequence, and no customer balance change. jde_receive_customer_payment
// (app/api/sales/payments) is the only path that keeps those four things in step.
const PAYMENT_TABLES = new Set(['payments_received', 'payment_allocations']);

export async function POST(request: Request, { params }: { params: Promise<{ table: string }> }) {
  const { table } = await params;
  if (!isKnownTable(table)) {
    return Response.json({ error: `Unknown table: ${table}` }, { status: 404 });
  }
  if (PAYMENT_TABLES.has(table)) {
    return Response.json({ error: 'Record a payment through Sales, not this endpoint.' }, { status: 403 });
  }
  try {
    const body = await request.json();
    if (new URL(request.url).searchParams.get('bulk') === '1') {
      // Keep bulk writes deliberately narrow: this is the inventory importer, not a generic
      // mass-write escape hatch for every ERP table.
      if (table !== 'products') {
        return Response.json({ error: 'Bulk import is only supported for products.' }, { status: 404 });
      }
      const rows = body?.rows;
      if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
        return Response.json({ error: 'Import rows must be an array of product records.' }, { status: 400 });
      }
      if (rows.length > 1_000) {
        return Response.json({ error: 'Import up to 1,000 parts at a time.' }, { status: 413 });
      }
      const created = await insertRows('products', rows as Record<string, unknown>[]);
      return Response.json({ imported: created.length }, { status: 201 });
    }
    const row = await insertRow(table, body);
    return Response.json(row, { status: 201 });
  } catch (error) {
    console.error(`POST /api/local/${table} failed:`, error);
    return Response.json({ error: dbErrorMessage(error, 'Failed to create record.') }, { status: 500 });
  }
}
