'use client';

import { useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { printCurrentPage } from '@/lib/client-export';
import { useCompanyTable } from '@/lib/useCompanyTable';

type ReportType = 'pnl' | 'sales' | 'stock' | 'gst';

type Invoice = { id: string; customer: string; date: string; total: number; paid: number; status: string };
type PurchaseOrder = { id: string; total: number };
type Expense = { amount: number };
type Product = { category: string; current_stock: number; cost_price: number; sale_price: number };

const GST_RATE = 0.18;

export default function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>('pnl');
  const [feedback, setFeedback] = useState('');

  const { rows: invoices } = useCompanyTable<Invoice>('invoices');
  const { rows: purchaseOrders } = useCompanyTable<PurchaseOrder>('purchase_orders');
  const { rows: expenses } = useCompanyTable<Expense>('expenses');
  const { rows: products } = useCompanyTable<Product>('products');

  const totalRevenue = invoices.reduce((t, i) => t + Number(i.total || 0), 0);
  const totalPurchaseSpend = purchaseOrders.reduce((t, p) => t + Number(p.total || 0), 0);
  const totalExpenses = expenses.reduce((t, e) => t + Number(e.amount || 0), 0);
  const grossMargin = totalRevenue - totalPurchaseSpend;
  const netResult = grossMargin - totalExpenses;

  const salesRows = [...invoices].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);

  const stockByCategory = new Map<string, { count: number; qty: number; cost: number; retail: number }>();
  for (const p of products) {
    const entry = stockByCategory.get(p.category) ?? { count: 0, qty: 0, cost: 0, retail: 0 };
    entry.count += 1;
    entry.qty += Number(p.current_stock || 0);
    entry.cost += Number(p.current_stock || 0) * Number(p.cost_price || 0);
    entry.retail += Number(p.current_stock || 0) * Number(p.sale_price || 0);
    stockByCategory.set(p.category, entry);
  }
  const stockRows = Array.from(stockByCategory.entries());
  const totalStockUnits = products.reduce((t, p) => t + Number(p.current_stock || 0), 0);

  const taxableSales = totalRevenue / (1 + GST_RATE);
  const outputGst = totalRevenue - taxableSales;
  const taxablePurchases = totalPurchaseSpend / (1 + GST_RATE);
  const inputTaxCredit = totalPurchaseSpend - taxablePurchases;
  const netGstPayable = outputGst - inputTaxCredit;

  return <div>
    <div className="page-header"><div><h1 className="page-title">Financial & Operational Reports</h1><p className="page-subtitle">Generate P&L statements, GST filing summaries, stock valuation and sales audit reports</p></div><div className="flex gap-2"><button className="btn btn-secondary" onClick={printCurrentPage}><Printer size={16} /> Print Report</button><a className="btn btn-primary" href={`/api/export?type=${reportType}`} download onClick={() => setFeedback('Report export started.')}><Download size={16} /> Export CSV</a></div></div>
    {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}
    <div className="tabs mb-6 report-tabs"><button className={`tab ${reportType === 'pnl' ? 'active' : ''}`} onClick={() => setReportType('pnl')}>Profit & Loss</button><button className={`tab ${reportType === 'sales' ? 'active' : ''}`} onClick={() => setReportType('sales')}>Sales Summary</button><button className={`tab ${reportType === 'stock' ? 'active' : ''}`} onClick={() => setReportType('stock')}>Stock Valuation</button><button className={`tab ${reportType === 'gst' ? 'active' : ''}`} onClick={() => setReportType('gst')}>GST Summary</button></div>

    {reportType === 'pnl' && <div className="card"><div className="card-header"><div><h3 className="card-title">Profit & Loss Statement (All Time)</h3><p className="text-muted text-sm">Approximate — purchases used as a cost-of-goods proxy since per-sale line items aren&apos;t tracked</p></div><span className="badge badge-success">{netResult >= 0 ? 'Profitable' : 'Loss'}</span></div><div className="report-summary">
      <div className="report-line report-strong"><span>Total Sales Revenue</span><strong className="text-success">₹{totalRevenue.toLocaleString()}</strong></div><div className="report-line indent"><span>Less: Purchases (COGS proxy)</span><span>- ₹{totalPurchaseSpend.toLocaleString()}</span></div><div className="report-line report-strong"><span>Gross Margin</span><strong className="text-brand">₹{grossMargin.toLocaleString()}</strong></div><div className="report-line indent"><span>Operating Expenses</span><span>- ₹{totalExpenses.toLocaleString()}</span></div><div className="report-total"><div><strong>Net Result</strong><small>After purchases and operational costs</small></div><strong>₹{netResult.toLocaleString()}</strong></div>
    </div></div>}

    {reportType === 'sales' && <div className="card"><div className="card-header"><h3 className="card-title">Sales Summary</h3><span className="badge badge-info">{salesRows.length} recent invoices</span></div><div className="table-wrap"><table className="erp-table"><thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th className="text-right">Amount</th><th>Status</th></tr></thead><tbody>{salesRows.map((row) => <tr key={row.id}><td className="text-brand font-semibold">{row.id}</td><td>{row.customer}</td><td className="text-muted">{row.date}</td><td className="text-right font-semibold">₹{Number(row.total).toLocaleString()}</td><td><span className={`badge ${row.status === 'paid' ? 'badge-success' : row.status === 'partial' ? 'badge-warning' : 'badge-danger'}`}>{row.status.toUpperCase()}</span></td></tr>)}
      {salesRows.length === 0 && <tr><td colSpan={5}><div className="empty-state"><p className="empty-state-title">No invoices yet</p><p className="empty-state-desc">This company has no sales on file.</p></div></td></tr>}
      </tbody></table></div></div>}

    {reportType === 'stock' && <div className="card"><div className="card-header"><h3 className="card-title">Warehouse Inventory Valuation Summary</h3><span className="badge badge-info">{totalStockUnits} Total Units</span></div><div className="table-wrap"><table className="erp-table"><thead><tr><th>Category</th><th>Product Count</th><th>Stock Quantity</th><th className="text-right">Cost Value</th><th className="text-right">Retail Value</th><th className="text-right">Expected Margin</th></tr></thead><tbody>{stockRows.map(([category, row]) => <tr key={category}><td>{category}</td><td>{row.count} Items</td><td>{row.qty} Pcs</td><td className="text-right">₹{row.cost.toLocaleString()}</td><td className="text-right">₹{row.retail.toLocaleString()}</td><td className="text-right text-success">₹{(row.retail - row.cost).toLocaleString()}</td></tr>)}
      {stockRows.length === 0 && <tr><td colSpan={6}><div className="empty-state"><p className="empty-state-title">No inventory yet</p><p className="empty-state-desc">This company has no parts on file.</p></div></td></tr>}
      </tbody></table></div></div>}

    {reportType === 'gst' && <div className="grid-2"><div className="card"><h3 className="card-title mb-4">GSTR-1 Sales Summary</h3><p className="text-muted text-sm mb-2">Assumes {(GST_RATE * 100).toFixed(0)}% GST inclusive in invoice totals</p><div className="report-line"><span>Taxable sales</span><strong>₹{taxableSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div><div className="report-line"><span>Output GST collected</span><strong>₹{outputGst.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div><div className="report-line"><span>Invoices</span><strong>{invoices.length}</strong></div></div><div className="card"><h3 className="card-title mb-4">GSTR-3B Liability</h3><div className="report-line"><span>Output GST</span><strong>₹{outputGst.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div><div className="report-line"><span>Input tax credit (on purchases)</span><strong className="text-success">- ₹{inputTaxCredit.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div><div className="report-total"><div><strong>Net GST payable</strong></div><strong>₹{Math.max(0, netGstPayable).toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div></div></div>}
  </div>;
}
