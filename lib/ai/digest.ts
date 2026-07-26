import { createClient } from '@/lib/supabase/server';

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function sum(rows: Array<{ [key: string]: unknown }>, field: string): number {
  return rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
}

export async function buildBusinessDigest() {
  const supabase = await createClient();

  const [
    { data: products },
    { data: customers },
    { data: suppliers },
    { data: invoices },
    { data: purchaseInvoices },
    { data: expenses },
    { data: salesOrders },
    { data: purchaseOrders },
    { data: quotations },
  ] = await Promise.all([
    supabase.from('erp_products').select('name, part_number, brand, category, current_stock, min_stock, cost_price, sale_price, is_active'),
    supabase.from('erp_customers').select('id, customer_type, credit_limit, opening_balance, is_active'),
    supabase.from('erp_suppliers').select('id, opening_balance, is_active'),
    supabase.from('erp_invoices').select('date, total, paid_amount, balance_due, status').gte('date', daysAgo(90)),
    supabase.from('erp_purchase_invoices').select('date, total, paid_amount, balance_due, status').gte('date', daysAgo(90)),
    supabase.from('erp_expenses').select('category, amount, expense_date').gte('expense_date', daysAgo(90)),
    supabase.from('erp_sales_orders').select('status, total, date'),
    supabase.from('erp_purchase_orders').select('status, total, date'),
    supabase.from('erp_quotations').select('status, total, date'),
  ]);

  const activeProducts = (products ?? []).filter((p) => p.is_active !== false);
  const lowStock = activeProducts
    .filter((p) => Number(p.current_stock) <= Number(p.min_stock))
    .map((p) => ({
      name: p.name,
      part_number: p.part_number,
      brand: p.brand,
      current_stock: p.current_stock,
      min_stock: p.min_stock,
    }));

  const stockValue = activeProducts.reduce((t, p) => t + (Number(p.current_stock) || 0) * (Number(p.cost_price) || 0), 0);

  const salesLast30 = (invoices ?? []).filter((i) => i.date >= daysAgo(30));
  const salesLast7 = (invoices ?? []).filter((i) => i.date >= daysAgo(7));
  const purchasesLast30 = (purchaseInvoices ?? []).filter((i) => i.date >= daysAgo(30));

  const expenseByCategory: Record<string, number> = {};
  for (const e of expenses ?? []) {
    const cat = String(e.category ?? 'other');
    expenseByCategory[cat] = (expenseByCategory[cat] ?? 0) + (Number(e.amount) || 0);
  }

  const countByStatus = (rows: Array<{ status: string | null }> | null) => {
    const counts: Record<string, number> = {};
    for (const r of rows ?? []) {
      const s = r.status ?? 'unknown';
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  };

  return {
    generated_at: new Date().toISOString(),
    window_days: 90,
    inventory: {
      active_product_count: activeProducts.length,
      total_stock_units: activeProducts.reduce((t, p) => t + (Number(p.current_stock) || 0), 0),
      stock_value_at_cost: Math.round(stockValue),
      low_stock_count: lowStock.length,
      low_stock_items: lowStock.slice(0, 15),
    },
    customers: {
      total: (customers ?? []).length,
      active: (customers ?? []).filter((c) => c.is_active !== false).length,
      total_credit_limit: sum(customers ?? [], 'credit_limit'),
      total_opening_receivables: sum(customers ?? [], 'opening_balance'),
    },
    suppliers: {
      total: (suppliers ?? []).length,
      total_opening_payables: sum(suppliers ?? [], 'opening_balance'),
    },
    sales: {
      invoice_count_90d: (invoices ?? []).length,
      revenue_90d: sum(invoices ?? [], 'total'),
      revenue_30d: sum(salesLast30, 'total'),
      revenue_7d: sum(salesLast7, 'total'),
      outstanding_receivables: sum(invoices ?? [], 'balance_due'),
      invoice_status_breakdown: countByStatus(invoices as Array<{ status: string | null }> | null),
      sales_order_status_breakdown: countByStatus(salesOrders as Array<{ status: string | null }> | null),
      open_quotations: (quotations ?? []).filter((q) => q.status === 'sent' || q.status === 'draft').length,
    },
    purchases: {
      invoice_count_90d: (purchaseInvoices ?? []).length,
      spend_90d: sum(purchaseInvoices ?? [], 'total'),
      spend_30d: sum(purchasesLast30, 'total'),
      outstanding_payables: sum(purchaseInvoices ?? [], 'balance_due'),
      purchase_order_status_breakdown: countByStatus(purchaseOrders as Array<{ status: string | null }> | null),
    },
    expenses: {
      total_90d: sum(expenses ?? [], 'amount'),
      by_category_90d: expenseByCategory,
    },
  };
}

export type BusinessDigest = Awaited<ReturnType<typeof buildBusinessDigest>>;

export async function buildReorderDigest() {
  const supabase = await createClient();

  const [{ data: products }, { data: ledgerEntries }] = await Promise.all([
    supabase
      .from('erp_products')
      .select('id, name, part_number, brand, category, current_stock, min_stock, cost_price, sale_price, is_active')
      .eq('is_active', true),
    supabase
      .from('erp_stock_ledger')
      .select('product_id, transaction_type, quantity, created_at')
      .eq('transaction_type', 'sale')
      .gte('created_at', daysAgo(60)),
  ]);

  const salesByProduct: Record<string, number> = {};
  for (const entry of ledgerEntries ?? []) {
    const id = String(entry.product_id);
    salesByProduct[id] = (salesByProduct[id] ?? 0) + Math.abs(Number(entry.quantity) || 0);
  }

  const items = (products ?? []).map((p) => ({
    part_number: p.part_number,
    name: p.name,
    brand: p.brand,
    category: p.category,
    current_stock: p.current_stock,
    min_stock: p.min_stock,
    cost_price: p.cost_price,
    units_sold_last_60d: salesByProduct[String(p.id)] ?? 0,
  }));

  return {
    generated_at: new Date().toISOString(),
    window_days: 60,
    has_sales_velocity_data: (ledgerEntries ?? []).length > 0,
    active_product_count: items.length,
    products: items,
  };
}

export type ReorderDigest = Awaited<ReturnType<typeof buildReorderDigest>>;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function buildDailyBriefingDigest() {
  const supabase = await createClient();
  const today = todayStr();
  const yesterday = daysAgo(1);

  const [
    { data: yesterdaySales },
    { data: overdueReceivables },
    { data: payablesDue },
    { data: products },
  ] = await Promise.all([
    supabase.from('erp_invoices').select('invoice_number, total').eq('date', yesterday),
    supabase
      .from('erp_invoices')
      .select('invoice_number, balance_due, due_date, customer:erp_customers(name)')
      .gt('balance_due', 0)
      .lte('due_date', today),
    supabase
      .from('erp_purchase_invoices')
      .select('invoice_number, balance_due, due_date, supplier:erp_suppliers(name)')
      .gt('balance_due', 0)
      .lte('due_date', today),
    supabase
      .from('erp_products')
      .select('name, part_number, current_stock, min_stock')
      .eq('is_active', true),
  ]);

  const lowStock = (products ?? []).filter((p) => Number(p.current_stock) <= Number(p.min_stock));

  return {
    date: today,
    yesterday_sales: {
      date: yesterday,
      invoice_count: (yesterdaySales ?? []).length,
      total: sum(yesterdaySales ?? [], 'total'),
    },
    receivables_due_today: {
      count: (overdueReceivables ?? []).length,
      total: sum(overdueReceivables ?? [], 'balance_due'),
      items: (overdueReceivables ?? []).slice(0, 10).map((r) => ({
        invoice_number: r.invoice_number,
        customer_name: (r.customer as unknown as { name: string } | null)?.name ?? 'Unknown customer',
        balance_due: r.balance_due,
        due_date: r.due_date,
      })),
    },
    payables_due_today: {
      count: (payablesDue ?? []).length,
      total: sum(payablesDue ?? [], 'balance_due'),
      items: (payablesDue ?? []).slice(0, 10).map((p) => ({
        invoice_number: p.invoice_number,
        supplier_name: (p.supplier as unknown as { name: string } | null)?.name ?? 'Unknown supplier',
        balance_due: p.balance_due,
        due_date: p.due_date,
      })),
    },
    low_stock: {
      count: lowStock.length,
      items: lowStock.slice(0, 10).map((p) => ({
        name: p.name,
        part_number: p.part_number,
        current_stock: p.current_stock,
        min_stock: p.min_stock,
      })),
    },
  };
}

export type DailyBriefingDigest = Awaited<ReturnType<typeof buildDailyBriefingDigest>>;
