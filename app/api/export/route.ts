import { listRows } from '@/lib/db';
import { resolveRequestCompanyId } from '@/lib/company-context';
import { invoiceBalanceDue } from '@/lib/invoice-balance';
import { AGE_BUCKETS, agingRows } from '@/lib/aging';
import { filterToPeriod, formatPeriod, isAllTime, type Period } from '@/lib/report-period';
import { stockValueLookup, totalStockValue, type StockLayerLike } from '@/lib/stock-value';
import { costOfSales, grossProfit, gstPosition, type PeriodConsumption, type PeriodInvoiceItem } from '@/lib/period-accounts';

type Invoice = { id: string; customer: string; date: string; total: number; paid: number; status: string; settlement_write_off: number; gst_amount: number | null; };
type PurchaseOrder = { total: number; supplier: string; date: string; paid: number; status: string; gst_amount: number | null };
type Expense = { amount: number; date: string };
type Product = { id: string; category: string; current_stock: number; cost_price: number; sale_price: number };
type Customer = { balance: number };
type Supplier = { balance: number };

function toCsv(rows: Array<Array<string | number>>): string {
  return rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
}

async function buildExport(type: string, period: Period): Promise<{ filename: string; rows: Array<Array<string | number>> }> {
  const companyId = await resolveRequestCompanyId();
  // Scoped to the same period the Reports screen is showing, so a downloaded file and the screen
  // it was downloaded from can never report different totals for the same question.
  const invoices = filterToPeriod((await listRows('invoices', companyId)) as unknown as Invoice[], (row) => row.date, period);
  const purchaseOrders = filterToPeriod((await listRows('purchase_orders', companyId)) as unknown as PurchaseOrder[], (row) => row.date, period);
  const expenses = filterToPeriod((await listRows('expenses', companyId)) as unknown as Expense[], (row) => row.date, period);
  const products = (await listRows('products', companyId)) as unknown as Product[];
  const customers = (await listRows('customers', companyId)) as unknown as Customer[];
  const suppliers = (await listRows('suppliers', companyId)) as unknown as Supplier[];
  // What each sale actually cost, batch by batch, and what tax each document actually carries.
  const invoiceItems = (await listRows('invoice_items', companyId)) as unknown as PeriodInvoiceItem[];
  const consumptions = (await listRows('stock_consumptions', companyId)) as unknown as PeriodConsumption[];

  const totalRevenue = invoices.reduce((t, i) => t + Number(i.total || 0), 0);
  const totalPurchaseSpend = purchaseOrders.reduce((t, p) => t + Number(p.total || 0), 0);
  const totalExpenses = expenses.reduce((t, e) => t + Number(e.amount || 0), 0);

  if (type === 'dashboard') {
    // Same rule as every screen — each batch at its own cost (lib/stock-value.ts). This used to
    // multiply by the cost_price field, so the CSV and the Dashboard reported different totals
    // for the same stock.
    const stockLayers = (await listRows('stock_layers', companyId)) as unknown as StockLayerLike[];
    const inventoryValue = totalStockValue(products, stockLayers);
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
    // The one shared valuation, so this CSV cannot disagree with the screen it came from.
    const stockLayers = (await listRows('stock_layers', companyId)) as unknown as StockLayerLike[];
    const stockValueFor = stockValueLookup(stockLayers);
    const byCategory = new Map<string, { count: number; qty: number; cost: number; retail: number }>();
    for (const p of products) {
      const entry = byCategory.get(p.category) ?? { count: 0, qty: 0, cost: 0, retail: 0 };
      entry.count += 1;
      entry.qty += Number(p.current_stock || 0);
      entry.cost += stockValueFor(p);
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
    // Only what the documents record. This used to divide the totals by 1.18 and export the
    // difference as tax collected, whatever the invoices actually charged.
    const gst = gstPosition(invoices, purchaseOrders);
    return {
      filename: 'jde-gst-summary.csv',
      rows: [
        ['Metric', 'Amount'],
        ['Sales invoiced', Math.round(totalRevenue)],
        ['Output GST charged', gst.outputTax],
        ['Input tax credit', gst.inputTax],
        ['Net GST payable', gst.netPayable],
        ['Invoices', gst.invoiceCount],
        ['Invoices carrying GST', gst.invoicesWithTax],
        ['Purchase orders', gst.purchaseCount],
        ['Purchase orders carrying GST', gst.purchasesWithTax],
      ],
    };
  }

  if (type === 'aging') {
    const today = new Date();
    const receivables = agingRows(invoices.map((i) => ({ key: i.customer, date: i.date, due: invoiceBalanceDue(i) })), today);
    const payables = agingRows(
      purchaseOrders.filter((p) => p.status === 'received').map((p) => ({ key: p.supplier, date: p.date, due: Number(p.total) - Number(p.paid) })),
      today
    );
    return {
      filename: 'jde-aging-summary.csv',
      rows: [
        ['Receivables Aging'],
        ['Customer', ...AGE_BUCKETS.map((bucket) => `${bucket} Days`)],
        ...receivables,
        [],
        ['Payables Aging'],
        ['Supplier', ...AGE_BUCKETS.map((bucket) => `${bucket} Days`)],
        ...payables,
      ],
    };
  }

  // Sales less what those sales cost, from the batches the goods came out of — not sales less
  // everything bought in the same window, which is a different figure entirely.
  const cost = costOfSales(invoices, invoiceItems, consumptions);
  const profit = grossProfit(invoices, cost);
  const notKnown = 'Not known';
  return {
    filename: 'jde-profit-and-loss.csv',
    rows: [
      ['Line Item', 'Amount'],
      ['Total Sales Revenue', totalRevenue],
      ['Cost of Goods Sold', cost.complete ? -cost.cost : notKnown],
      ['Gross Profit', profit ? profit.grossProfit : notKnown],
      ['Operating Expenses', -totalExpenses],
      ['Net Result', profit ? profit.grossProfit - totalExpenses : notKnown],
      ['Purchases in this period', -totalPurchaseSpend],
      ...(cost.complete ? [] : [['Invoice lines with no recorded cost', cost.linesWithoutCost]]),
    ],
  };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const type = params.get('type') ?? 'pnl';
  // The Reports screen sends the period it is showing. A direct hit with neither covers everything,
  // which is what this route did before the screen had a period at all.
  const isDay = (value: string | null): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const from = params.get('from');
  const to = params.get('to');
  const period: Period = { start: isDay(from) ? from : null, end: isDay(to) ? to : null };
  const report = await buildExport(type, period);
  // The period goes in the filename and in the first row: a CSV that lands in somebody's Downloads
  // folder has to carry what it covers, or two exports of the same report are indistinguishable.
  const rows: Array<Array<string | number>> = [
    [`Period: ${formatPeriod(period)}`],
    [],
    ...report.rows,
  ];
  const suffix = isAllTime(period) ? '' : `-${period.start ?? 'start'}-to-${period.end ?? 'today'}`;
  const filename = report.filename.replace(/\.csv$/, `${suffix}.csv`);
  const csv = toCsv(rows);
  return new Response(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
