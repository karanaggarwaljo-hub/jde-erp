import { dbErrorMessage, saveSalesInvoice } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json();
  const {
    companyId, invoiceId, isEdit, customerLabel, oldCustomerId, newCustomerId,
    oldOutstanding, newOutstanding, date, items, total, paid, status, mode,
    discountPercent, discountAmount,
  } = body ?? {};

  if (typeof companyId !== 'string' || !companyId) {
    return Response.json({ error: 'companyId is required' }, { status: 400 });
  }
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
    });
    return Response.json(invoice, { status: 201 });
  } catch (error) {
    console.error('POST /api/sales/save-invoice failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Failed to save this invoice.') }, { status: 500 });
  }
}
