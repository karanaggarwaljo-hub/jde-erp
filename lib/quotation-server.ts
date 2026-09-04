import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { QuotationDetail, QuotationInput } from '@/lib/client-quotations';

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) throw new Error('Supabase is not configured.');
    client = createClient(url, serviceKey, { auth: { persistSession: false } });
  }
  return client;
}

/**
 * Database contract (installed separately as a migration):
 * - jde_quotation_items has quotation_id, product_id, part_number, name, qty, unit_price,
 *   line_total and company_id. jde_quotations stores the displayed totals/tax fields.
 * - jde_save_quotation atomically replaces the quotation's lines and header; it must not touch
 *   products, stock layers, invoices, or customer balances. It carries a status of 'draft' or
 *   'final' and will not turn a confirmed quotation back into a draft.
 * - jde_convert_quotation_to_invoice atomically reads those persisted lines, creates the invoice,
 *   consumes FIFO stock, adjusts the customer balance, and marks the quote converted. It refuses
 *   a quotation still marked 'draft' — an unfinished quote must never become money.
 */
export async function loadQuotation(quotationId: string, companyId: string): Promise<QuotationDetail> {
  const supabase = getClient();
  const { data: quotation, error: quotationError } = await supabase
    .from('jde_quotations')
    .select('*')
    .eq('id', quotationId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (quotationError) throw quotationError;
  if (!quotation) throw new Error('Quotation not found for the active company.');

  const { data: items, error: itemsError } = await supabase
    .from('jde_quotation_items')
    .select('product_id, part_number, name, qty, unit_price, line_total, discount_percent, discount_amount')
    .eq('quotation_id', quotationId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: true });
  if (itemsError) throw itemsError;
  return { ...(quotation as Omit<QuotationDetail, 'items'>), items: (items ?? []) } as QuotationDetail;
}

export async function saveQuotation(input: QuotationInput): Promise<QuotationDetail> {
  const { data, error } = await getClient().rpc('jde_save_quotation', {
    p_company_id: input.companyId,
    p_quotation_id: input.quotationId,
    p_is_edit: input.isEdit,
    p_customer_id: input.customerId,
    p_customer_label: input.customerLabel,
    p_date: input.date,
    p_validity: input.validity,
    p_items: input.items,
    p_subtotal: input.subtotal,
    p_discount_percent: input.discountPercent,
    p_discount_amount: input.discountAmount,
    p_gst_percent: input.gstPercent,
    p_gst_amount: input.gstAmount,
    p_gst_mode: input.gstMode ?? 'exclusive',
    // Only an explicit 'final' confirms a quotation. Anything else — a missing field, a stale
    // client, a hand-made request — parks it as a draft, which commits nothing. The database
    // repeats this check and refuses any other value outright.
    p_status: input.status === 'final' ? 'final' : 'draft',
    p_total: input.total,
  }).single();
  if (error) throw error;
  return data as QuotationDetail;
}

export async function convertQuotation(quotationId: string, companyId: string): Promise<{ invoiceId: string }> {
  const { data, error } = await getClient().rpc('jde_convert_quotation_to_invoice', {
    p_quotation_id: quotationId,
    p_company_id: companyId,
  }).single();
  if (error) throw error;
  return data as { invoiceId: string };
}
