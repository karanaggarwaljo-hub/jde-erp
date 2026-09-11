import { dbErrorMessage, getRow, saveSalesInvoice } from '@/lib/db';
import { checkCompanyAccess } from '@/lib/auth/dal';
import { money, recordAudit } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json();
  const {
    companyId, invoiceId, isEdit, customerLabel, oldCustomerId, newCustomerId,
    oldOutstanding, newOutstanding, date, items, total, paid, status, mode,
    discountPercent, discountAmount, gstPercent, gstAmount, gstMode,
  } = body ?? {};

  if (typeof companyId !== 'string' || !companyId) {
    return Response.json({ error: 'companyId is required' }, { status: 400 });
  }
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  // Only required when editing an existing invoice — a new invoice's id is generated inside the
  // database transaction itself (globally unique across every company, not something the caller
  // can safely guess), so invoiceId is ignored entirely when isEdit is false.
  if (isEdit && (typeof invoiceId !== 'string' || !invoiceId)) {
    return Response.json({ error: 'invoiceId is required when editing an invoice' }, { status: 400 });
  }
  if (!Array.isArray(items)) {
    return Response.json({ error: 'items must be an array' }, { status: 400 });
  }

  try {
    // Read before writing, on an edit only. An edit is where money changes silently — a total or
    // an amount received quietly becoming a different number — so the audit entry has to be able
    // to say what it was, not only what it became.
    const before = isEdit ? await getRow('invoices', String(invoiceId)) : null;

    const invoice = await saveSalesInvoice({
      companyId,
      invoiceId: isEdit ? invoiceId : null,
      isEdit: Boolean(isEdit),
      customerLabel: String(customerLabel ?? ''),
      oldCustomerId: oldCustomerId ?? null,
      newCustomerId: newCustomerId ?? null,
      oldOutstanding: Number(oldOutstanding) || 0,
      newOutstanding: Number(newOutstanding) || 0,
      date: String(date ?? ''),
      items,
      total: Number(total) || 0,
      paid: Number(paid) || 0,
      status: String(status ?? 'unpaid'),
      mode: String(mode ?? 'Credit'),
      discountPercent: Number(discountPercent) || 0,
      discountAmount: Number(discountAmount) || 0,
      gstPercent: Number(gstPercent) || 0,
      gstAmount: Number(gstAmount) || 0,
      gstMode: gstMode === 'inclusive' ? 'inclusive' : 'exclusive',
    });
    const savedId = String(invoice.id);
    const newTotal = Number(invoice.total ?? 0);
    await recordAudit({
      companyId,
      action: isEdit ? 'invoice.edit' : 'invoice.create',
      entity: 'invoices',
      entityId: savedId,
      summary: isEdit
        ? `Edited ${savedId}${before && Number(before.total ?? 0) !== newTotal ? `, changing its total from ${money(Number(before.total ?? 0))} to ${money(newTotal)}` : ''}`
        : `Created ${savedId} for ${String(customerLabel ?? '')} at ${money(newTotal)}`,
      details: {
        ...(before ? { before: { total: before.total, paid: before.paid, status: before.status, items: before.items } } : {}),
        after: { total: invoice.total, paid: invoice.paid, status: invoice.status, items: invoice.items },
      },
    });
    return Response.json(invoice, { status: 201 });
  } catch (error) {
    console.error('POST /api/sales/save-invoice failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Failed to save this invoice.') }, { status: 500 });
  }
}
