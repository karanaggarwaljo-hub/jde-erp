import { getActiveCompanyId, listRows } from '@/lib/db';

type Invoice = { id: string; customer: string; date: string; total: number; paid: number; status: string };
type PurchaseOrder = { total: number };
type Expense = { amount: number };
type Product = { category: string; current_stock: number; cost_price: number; sale_price: number };
type Customer = { balance: number };
type Supplier = { balance: number };

const GST_RATE = 0.18;

function toCsv(rows: Array<Array<string | number>>): string {
  return rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
}

async function buildExport(type: string): Promise<{ filename: string; rows: Array<Array<string | number>> }> {
  const companyId = await getActiveCompanyId();
  const invoices = (await listRows('invoices', companyId)) as unknown as Invoice[];
  const purchaseOrders = (await listRows('purchase_orders', companyId)) as unknown as PurchaseOrder[];
  const expenses = (await listRows('expenses', companyId)) as unknown as Expense[];
  const products = (await listRows('products', companyId)) as unknown as Product[];
  const customers = (await listRows('customers', companyId)) as unknown as Customer[];
  const suppliers = (await listRows('suppliers', companyId)) as unknown as Supplier[];

  const totalRevenue = invoices.reduce((t, i) => t + Number(i.total || 0), 0);
  const totalPurchaseSpend = purchaseOrders.reduce((t, p) => t + Number(p.total || 0), 0);
  const totalExpenses = expenses.reduce((t, e) => t + Number(e.amount || 0), 0);

  if (type === 'dashboard') {
    const inventoryValue = products.reduce((t, p) => t + Number(p.current_stock || 0) * Number(p.cost_price || 0), 0);
    const totalReceivables = customers.reduce((t, c) => t + Number(c.balance || 0), 0);
    const totalPayables = suppliers.reduce((t, s) => t + Number(s.balance || 0), 0);
    const lowStockCount = products.filter((p) => Number(p.current_stock) <= 0).length;
    return {
      filename: 'jde-dashboard-summary.csv',
      rows: [
        ['Metric', 'Value'],
        ['Total Sales Revenue', totalRevenue],
        ['Total Purchase Spend', totalPurchaseSpend],
        ['Total Expenses', totalExpenses],
        ['Inventory Value (at cost)', Math.round(inventoryValue)],
        ['Total Receivables', totalReceivables],
        ['Total Payables', totalPayables],
        ['Products at/below min stock', lowStockCount],
      ],
    };
  }

  if (type === 'sales') {
    return {
      filename: 'jde-sales-summary.csv',
      rows: [['Invoice', 'Customer', 'Date', 'Amount', 'Status'], ...invoices.map((i) => [i.id, i.customer, i.date, i.total, i.status])],
    };
  }

  if (type === 'stock') {
    const byCategory = new Map<string, { count: number; qty: number; cost: number; retail: number }>();
    for (const p of products) {
      const entry = byCategory.get(p.category) ?? { count: 0, qty: 0, cost: 0, retail: 0 };
      entry.count += 1;
      entry.qty += Number(p.current_stock || 0);
      entry.cost += Number(p.current_stock || 0) * Number(p.cost_price || 0);
      entry.retail += Number(p.current_stock || 0) * Number(p.sale_price || 0);
      byCategory.set(p.category, entry);
    }
    return {
      filename: 'jde-stock-valuation.csv',
      rows: [
        ['Category', 'Product Count', 'Stock Quantity', 'Cost Value', 'Retail Value', 'Expected Margin'],
        ...Array.from(byCategory.entries()).map(([category, e]) => [category, e.count, e.qty, e.cost, e.retail, e.retail - e.cost]),
      ],
    };
  }

  if (type === 'gst') {
    const taxableSales = totalRevenue / (1 + GST_RATE);
    const outputGst = totalRevenue - taxableSales;
    const taxablePurchases = totalPurchaseSpend / (1 + GST_RATE);
    const inputTaxCredit = totalPurchaseSpend - taxablePurchases;
    return {
      filename: 'jde-gst-summary.csv',
      rows: [
        ['Metric', 'Amount'],
        ['Taxable sales', Math.round(taxableSales)],
        ['Output GST', Math.round(outputGst)],
        ['Input tax credit', Math.round(inputTaxCredit)],
        ['Net GST payable', Math.round(Math.max(0, outputGst - inputTaxCredit))],
      ],
    };
  }

  const grossMargin = totalRevenue - totalPurchaseSpend;
  return {
    filename: 'jde-profit-and-loss.csv',
    rows: [
      ['Line Item', 'Amount'],
      ['Total Sales Revenue', totalRevenue],
      ['Purchases (COGS proxy)', -totalPurchaseSpend],
      ['Gross Margin', grossMargin],
      ['Operating Expenses', -totalExpenses],
      ['Net Result', grossMargin - totalExpenses],
    ],
  };
}

export async function GET(request: Request) {
  const type = new URL(request.url).searchParams.get('type') ?? 'pnl';
  const report = await buildExport(type);
  const csv = toCsv(report.rows);
  return new Response(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${report.filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
