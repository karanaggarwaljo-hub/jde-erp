import { dbErrorMessage, getActiveCompanyId, insertRows, isCompanyScoped, isKnownTable, listRows, insertRow } from '@/lib/db';
import { checkCompanyAccess, getCurrentUser } from '@/lib/auth/dal';
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
      const created = await insertRows('products', scopedRows);
      return Response.json({ imported: created.length }, { status: 201 });
    }

    const row = await insertRow(table, verifiedCompanyId ? { ...body, company_id: verifiedCompanyId } : body);
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
