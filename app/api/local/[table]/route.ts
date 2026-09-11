import { dbErrorMessage, getActiveCompanyId, insertRows, isCompanyScoped, isKnownTable, listRows, insertRow } from '@/lib/db';
import { checkCompanyAccess, getCurrentUser } from '@/lib/auth/dal';
import { refuseGenericWrite } from '@/lib/generic-write-guard';
import { describeRow, recordAudit } from '@/lib/audit-log';
import { describeCodeClashes, findCodeClashes } from '@/lib/import-part-codes';
import { TABLES } from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import { after } from 'next/server';
import {
  dispatchPendingCompanyEvents,
  type CompanyEventInitiator,
} from '@/lib/integration/adaptive-platform-company-events';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ table: string }> }) {
  const { table } = await params;
  if (!isKnownTable(table)) {
    return Response.json({ error: `Unknown table: ${table}` }, { status: 404 });
  }
  const companyId = new URL(request.url).searchParams.get('company_id') ?? undefined;
  // Company-scoped tables must be scoped: an omitted company_id used to fall through to
  // listRows returning every company's rows unfiltered. Not just missing a filter — a caller
  // could also simply supply a *different* company's id, which is what the access check below
  // actually stops (a present-but-empty companyId is still rejected as missing on purpose).
  if (isCompanyScoped(table)) {
    if (!companyId) return Response.json({ error: 'company_id is required.' }, { status: 400 });
    const access = await checkCompanyAccess(companyId);
    if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  }
  try {
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
  // Only master data may be created here. Everything a sale, purchase, payment or return
  // produces is written by its own route, in one transaction with the stock and balance changes
  // that belong to it. Two tables used to be excluded by name; every transaction table is now.
  const refusal = refuseGenericWrite(table, 'create');
  if (refusal) return refusal;
  try {
    const body = await request.json();

    let companyInitiator: CompanyEventInitiator | undefined;
    if (table === 'companies') {
      const staff = await getCurrentUser();
      if (!staff) return Response.json({ error: 'Authentication required.' }, { status: 401 });
      if (staff.role !== 'owner') {
        return Response.json({ error: 'Only the owner can create a company.' }, { status: 403 });
      }
      const supabase = await createClient();
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
      const issuerBase = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!issuerBase) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured.');
      companyInitiator = {
        issuer: `${issuerBase.replace(/\/$/u, '')}/auth/v1`,
        subject: user.id,
        displayName: staff.name ?? staff.email,
      };
    }

    // Resolved and access-checked once, then FORCED onto whatever gets written below — never
    // just "checked and trusted." A client-supplied company_id that happens to pass the check
    // is fine to use; one that's absent falls back to the active company; either way, the value
    // actually written is always this verified one, not whatever shape the request body took.
    let verifiedCompanyId: string | undefined;
    if (isCompanyScoped(table)) {
      const claimed = typeof body?.company_id === 'string' && body.company_id ? body.company_id : undefined;
      const companyId = claimed ?? (await getActiveCompanyId());
      if (!companyId) return Response.json({ error: 'company_id is required.' }, { status: 400 });
      const access = await checkCompanyAccess(companyId);
      if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
      verifiedCompanyId = companyId;
    }

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
      const scopedRows = (rows as Record<string, unknown>[]).map((row) => ({ ...row, company_id: verifiedCompanyId }));

      // A part number names one part, and the database now refuses a second with the same one. A
      // whole spreadsheet would otherwise fail on a constraint message nobody can act on, so the
      // clashes are found first and named — which codes, and which rows of the file they are on.
      const existing = (await listRows('products', verifiedCompanyId)) as unknown as Array<{ part_number?: string }>;
      const clashes = findCodeClashes(scopedRows, existing.map((part) => part.part_number ?? ''));
      if (clashes.length > 0) {
        return Response.json({ error: describeCodeClashes(clashes) }, { status: 422 });
      }

      const created = await insertRows('products', scopedRows);
      await recordAudit({
        companyId: verifiedCompanyId ?? '', action: 'products.import', entity: 'products',
        summary: `Imported ${created.length} part${created.length === 1 ? '' : 's'} from a file`,
        details: { imported: created.length },
      });
      return Response.json({ imported: created.length }, { status: 201 });
    }

    const row = await insertRow(table, verifiedCompanyId ? { ...body, company_id: verifiedCompanyId } : body);
    await recordAudit({
      companyId: verifiedCompanyId ?? String(row.id ?? ''), action: `${table}.create`, entity: table,
      entityId: String(row[TABLES[table].primaryKey] ?? ''),
      summary: `Added ${describeRow(table, row)}`,
    });
    if (table === 'companies' && typeof row.id === 'string') {
      const aggregateId = row.id;
      const initiator = companyInitiator;
      after(async () => {
        try {
          await dispatchPendingCompanyEvents({ aggregateId, ...(initiator === undefined ? {} : { initiator }) });
        } catch (error: unknown) {
          // The database outbox keeps this retryable; company creation itself has already committed.
          console.error('Immediate adaptive-platform company onboarding failed:', error);
        }
      });
    }
    return Response.json(row, { status: 201 });
  } catch (error) {
    console.error(`POST /api/local/${table} failed:`, error);
    return Response.json({ error: dbErrorMessage(error, 'Failed to create record.') }, { status: 500 });
  }
}
