'use client';

import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Download, Printer, TrendingUp, TrendingDown, ShoppingBag, Wallet, Receipt, IndianRupee, AlertCircle, PackageCheck, Percent } from 'lucide-react';
import { printCurrentPage } from '@/lib/client-export';
import { useCompanyTable } from '@/lib/useCompanyTable';
import AIReportSummary from '@/components/AIReportSummary';

type ReportType = 'pnl' | 'sales' | 'stock' | 'gst' | 'aging';

type Invoice = { id: string; customer: string; date: string; total: number; paid: number; status: string };
type PurchaseOrder = { id: string; supplier: string; date: string; total: number; paid: number; status: string };
type Expense = { amount: number };
type Product = { category: string; current_stock: number; cost_price: number; sale_price: number };

const GST_RATE = 0.18;
const AGE_BUCKETS = ['0-30', '31-60', '61-90', '90+'] as const;
type AgeBucket = typeof AGE_BUCKETS[number];
const BUCKET_COLORS: Record<AgeBucket, string> = { '0-30': '#10B981', '31-60': '#F59E0B', '61-90': '#F97316', '90+': '#EF4444' };
const BUCKET_BG: Record<AgeBucket, string> = { '0-30': 'rgba(16,185,129,0.1)', '31-60': 'rgba(245,158,11,0.1)', '61-90': 'rgba(249,115,22,0.1)', '90+': 'rgba(239,68,68,0.1)' };
const CATEGORY_COLORS = ['#F59E0B', '#3B82F6', '#10B981', '#8B5CF6', '#EC4899', '#06B6D4'];

function emptyBuckets(): Record<AgeBucket, number> {
  return { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
}

function bucketFor(days: number): AgeBucket {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

function daysSince(dateStr: string, today: Date) {
  const then = new Date(dateStr);
  return Math.max(0, Math.floor((today.getTime() - then.getTime()) / 86400000));
}

function agingFrom(rows: Array<{ key: string; date: string; due: number }>, today: Date) {
  const totals = emptyBuckets();
  const byKey = new Map<string, Record<AgeBucket, number>>();
  for (const row of rows) {
    if (row.due <= 0) continue;
    const bucket = bucketFor(daysSince(row.date, today));
    totals[bucket] += row.due;
    const entry = byKey.get(row.key) ?? emptyBuckets();
    entry[bucket] += row.due;
    byKey.set(row.key, entry);
  }
  return { totals, byKey };
}

function Kpi({ title, value, icon: Icon, color, bg }: { title: string; value: string; icon: LucideIcon; color: string; bg: string }) {
  return (
    <div className="kpi-card" style={{ '--kpi-color': color, '--kpi-color-bg': bg } as React.CSSProperties}>
      <div className="flex justify-between items-center">
        <span className="kpi-label">{title}</span>
        <div className="kpi-icon-wrap"><Icon size={18} /></div>
      </div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

function ValueBars({ rows }: { rows: Array<{ label: string; value: number; color: string }> }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="category-bars">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="flex justify-between mb-1"><strong>{row.label}</strong><span>₹{row.value.toLocaleString()}</span></div>
          <div className="progress-track"><div style={{ width: `${Math.min(100, (Math.abs(row.value) / max) * 100)}%`, background: row.color }} /></div>
        </div>
      ))}
    </div>
  );
}

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
  const avgOrderValue = invoices.length > 0 ? totalRevenue / invoices.length : 0;
  const salesOutstandingDue = invoices.reduce((t, i) => t + Math.max(0, Number(i.total) - Number(i.paid)), 0);

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
  const totalCostValue = stockRows.reduce((t, [, row]) => t + row.cost, 0);
  const totalRetailValue = stockRows.reduce((t, [, row]) => t + row.retail, 0);
  const stockCategoryMix = stockRows
    .map(([category, row], index) => ({ category, amount: row.cost, share: totalCostValue > 0 ? Math.round((row.cost / totalCostValue) * 100) : 0, color: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }))
    .sort((a, b) => b.amount - a.amount);

  const taxableSales = totalRevenue / (1 + GST_RATE);
  const outputGst = totalRevenue - taxableSales;
  const taxablePurchases = totalPurchaseSpend / (1 + GST_RATE);
  const inputTaxCredit = totalPurchaseSpend - taxablePurchases;
  const netGstPayable = outputGst - inputTaxCredit;

  const today = new Date();
  const receivablesAging = agingFrom(
    invoices.map((inv) => ({ key: inv.customer, date: inv.date, due: Number(inv.total) - Number(inv.paid) })),
    today
  );
  const payablesAging = agingFrom(
    purchaseOrders.filter((po) => po.status === 'received').map((po) => ({ key: po.supplier, date: po.date, due: Number(po.total) - Number(po.paid) })),
    today
  );
  const totalReceivablesDue = AGE_BUCKETS.reduce((t, b) => t + receivablesAging.totals[b], 0);
  const totalPayablesDue = AGE_BUCKETS.reduce((t, b) => t + payablesAging.totals[b], 0);

  const summaryData: Record<ReportType, unknown> = {
    pnl: { total_revenue: totalRevenue, total_purchase_spend: totalPurchaseSpend, gross_margin: grossMargin, total_expenses: totalExpenses, net_result: netResult },
    sales: { invoice_count: invoices.length, recent_invoices: salesRows.slice(0, 10).map((r) => ({ id: r.id, customer: r.customer, date: r.date, total: r.total, status: r.status })) },
    stock: { total_stock_units: totalStockUnits, by_category: stockRows.map(([category, row]) => ({ category, ...row })) },
    gst: { taxable_sales: Math.round(taxableSales), output_gst: Math.round(outputGst), input_tax_credit: Math.round(inputTaxCredit), net_gst_payable: Math.round(Math.max(0, netGstPayable)) },
    aging: { total_receivables_due: totalReceivablesDue, total_payables_due: totalPayablesDue, receivables_by_bucket: receivablesAging.totals, payables_by_bucket: payablesAging.totals },
  };

  return <div>
    <div className="page-header"><div><h1 className="page-title">Financial & Operational Reports</h1><p className="page-subtitle">Generate P&L statements, GST filing summaries, stock valuation and sales audit reports</p></div><div className="flex gap-2"><button className="btn btn-secondary" onClick={printCurrentPage}><Printer size={16} /> Print Report</button><a className="btn btn-primary" href={`/api/export?type=${reportType}`} download onClick={() => setFeedback('Report export started.')}><Download size={16} /> Export CSV</a></div></div>
    {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}
    <div className="tabs mb-6 report-tabs"><button className={`tab ${reportType === 'pnl' ? 'active' : ''}`} onClick={() => setReportType('pnl')}>Profit & Loss</button><button className={`tab ${reportType === 'sales' ? 'active' : ''}`} onClick={() => setReportType('sales')}>Sales Summary</button><button className={`tab ${reportType === 'stock' ? 'active' : ''}`} onClick={() => setReportType('stock')}>Stock Valuation</button><button className={`tab ${reportType === 'gst' ? 'active' : ''}`} onClick={() => setReportType('gst')}>GST Summary</button><button className={`tab ${reportType === 'aging' ? 'active' : ''}`} onClick={() => setReportType('aging')}>Aging</button></div>

    <AIReportSummary reportType={reportType} data={summaryData[reportType]} />

    {reportType === 'pnl' && <>
      <div className="kpi-grid">
        <Kpi title="Total Revenue" value={`₹${totalRevenue.toLocaleString()}`} icon={TrendingUp} color="#10B981" bg="rgba(16,185,129,0.1)" />
        <Kpi title="Purchases (COGS)" value={`₹${totalPurchaseSpend.toLocaleString()}`} icon={ShoppingBag} color="#3B82F6" bg="rgba(59,130,246,0.1)" />
        <Kpi title="Gross Margin" value={`₹${grossMargin.toLocaleString()}`} icon={Wallet} color="#F59E0B" bg="rgba(245,158,11,0.1)" />
        <Kpi title="Net Result" value={`₹${netResult.toLocaleString()}`} icon={netResult >= 0 ? TrendingUp : TrendingDown} color={netResult >= 0 ? '#10B981' : '#EF4444'} bg={netResult >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'} />
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-header"><h3 className="card-title">Revenue vs. Costs</h3></div>
          <ValueBars rows={[
            { label: 'Total Revenue', value: totalRevenue, color: '#10B981' },
            { label: 'Purchases (COGS)', value: totalPurchaseSpend, color: '#3B82F6' },
            { label: 'Operating Expenses', value: totalExpenses, color: '#F97316' },
            { label: 'Net Result', value: netResult, color: netResult >= 0 ? '#F59E0B' : '#EF4444' },
          ]} />
        </div>
        <div className="card">
          <div className="card-header"><div><h3 className="card-title">Profit & Loss Statement (All Time)</h3><p className="text-muted text-sm">Purchases used as a cost-of-goods proxy</p></div><span className={`badge ${netResult >= 0 ? 'badge-success' : 'badge-danger'}`}>{netResult >= 0 ? 'Profitable' : 'Loss'}</span></div>
          <div className="report-summary" style={{ padding: '8px 0' }}>
            <div className="report-line report-strong"><span>Total Sales Revenue</span><strong className="text-success">₹{totalRevenue.toLocaleString()}</strong></div>
            <div className="report-line indent"><span>Less: Purchases (COGS proxy)</span><span>- ₹{totalPurchaseSpend.toLocaleString()}</span></div>
            <div className="report-line report-strong"><span>Gross Margin</span><strong className="text-brand">₹{grossMargin.toLocaleString()}</strong></div>
            <div className="report-line indent"><span>Operating Expenses</span><span>- ₹{totalExpenses.toLocaleString()}</span></div>
            <div className="report-total"><div><strong>Net Result</strong><small>After purchases and operational costs</small></div><strong>₹{netResult.toLocaleString()}</strong></div>
          </div>
        </div>
      </div>
    </>}

    {reportType === 'sales' && <>
      <div className="kpi-grid">
        <Kpi title="Total Invoices" value={`${invoices.length}`} icon={Receipt} color="#3B82F6" bg="rgba(59,130,246,0.1)" />
        <Kpi title="Total Revenue" value={`₹${totalRevenue.toLocaleString()}`} icon={TrendingUp} color="#10B981" bg="rgba(16,185,129,0.1)" />
        <Kpi title="Avg Order Value" value={`₹${avgOrderValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} icon={IndianRupee} color="#F59E0B" bg="rgba(245,158,11,0.1)" />
        <Kpi title="Outstanding Due" value={`₹${salesOutstandingDue.toLocaleString()}`} icon={AlertCircle} color="#EF4444" bg="rgba(239,68,68,0.1)" />
      </div>
      <div className="card"><div className="card-header"><h3 className="card-title">Recent Invoices</h3><span className="badge badge-info">{salesRows.length} shown</span></div><div className="table-wrap"><table className="erp-table"><thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th className="text-right">Amount</th><th>Status</th></tr></thead><tbody>{salesRows.map((row) => <tr key={row.id}><td className="text-brand font-semibold">{row.id}</td><td>{row.customer}</td><td className="text-muted">{row.date}</td><td className="text-right font-semibold">₹{Number(row.total).toLocaleString()}</td><td><span className={`badge ${row.status === 'paid' ? 'badge-success' : row.status === 'partial' ? 'badge-warning' : 'badge-danger'}`}>{row.status.toUpperCase()}</span></td></tr>)}
        {salesRows.length === 0 && <tr><td colSpan={5}><div className="empty-state"><p className="empty-state-title">No invoices yet</p><p className="empty-state-desc">This company has no sales on file.</p></div></td></tr>}
        </tbody></table></div></div>
    </>}

    {reportType === 'stock' && <>
      <div className="kpi-grid">
        <Kpi title="Total Stock Units" value={`${totalStockUnits}`} icon={PackageCheck} color="#3B82F6" bg="rgba(59,130,246,0.1)" />
        <Kpi title="Total Cost Value" value={`₹${totalCostValue.toLocaleString()}`} icon={Wallet} color="#F59E0B" bg="rgba(245,158,11,0.1)" />
        <Kpi title="Total Retail Value" value={`₹${totalRetailValue.toLocaleString()}`} icon={TrendingUp} color="#10B981" bg="rgba(16,185,129,0.1)" />
        <Kpi title="Expected Margin" value={`₹${(totalRetailValue - totalCostValue).toLocaleString()}`} icon={Percent} color="#8B5CF6" bg="rgba(139,92,246,0.1)" />
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-header"><h3 className="card-title">Category Value Mix</h3><span className="badge badge-info">At Cost</span></div>
          <div className="category-bars">
            {stockCategoryMix.length === 0 && <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No inventory yet for this company.</p>}
            {stockCategoryMix.map((category) => <div key={category.category}><div className="flex justify-between mb-1"><strong>{category.category}</strong><span>₹{category.amount.toLocaleString()} ({category.share}%)</span></div><div className="progress-track"><div style={{ width: `${category.share}%`, background: category.color }} /></div></div>)}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="card-title">Warehouse Inventory Valuation</h3><span className="badge badge-info">{totalStockUnits} Total Units</span></div>
          <div className="table-wrap"><table className="erp-table"><thead><tr><th>Category</th><th>Items</th><th>Qty</th><th className="text-right">Cost</th><th className="text-right">Retail</th></tr></thead><tbody>{stockRows.map(([category, row]) => <tr key={category}><td>{category}</td><td>{row.count}</td><td>{row.qty}</td><td className="text-right">₹{row.cost.toLocaleString()}</td><td className="text-right">₹{row.retail.toLocaleString()}</td></tr>)}
            {stockRows.length === 0 && <tr><td colSpan={5}><div className="empty-state"><p className="empty-state-title">No inventory yet</p><p className="empty-state-desc">This company has no parts on file.</p></div></td></tr>}
            </tbody></table></div>
        </div>
      </div>
    </>}

    {reportType === 'gst' && <>
      <div className="kpi-grid">
        <Kpi title="Taxable Sales" value={`₹${taxableSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} icon={Receipt} color="#3B82F6" bg="rgba(59,130,246,0.1)" />
        <Kpi title="Output GST Collected" value={`₹${outputGst.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} icon={TrendingUp} color="#F97316" bg="rgba(249,115,22,0.1)" />
        <Kpi title="Input Tax Credit" value={`₹${inputTaxCredit.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} icon={TrendingDown} color="#10B981" bg="rgba(16,185,129,0.1)" />
        <Kpi title="Net GST Payable" value={`₹${Math.max(0, netGstPayable).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} icon={IndianRupee} color="#EF4444" bg="rgba(239,68,68,0.1)" />
      </div>
      <div className="grid-2">
        <div className="card"><h3 className="card-title mb-4">GSTR-1 Sales Summary</h3><p className="text-muted text-sm mb-2">Assumes {(GST_RATE * 100).toFixed(0)}% GST inclusive in invoice totals</p><div className="report-line"><span>Taxable sales</span><strong>₹{taxableSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div><div className="report-line"><span>Output GST collected</span><strong>₹{outputGst.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div><div className="report-line"><span>Invoices</span><strong>{invoices.length}</strong></div></div>
        <div className="card"><h3 className="card-title mb-4">GSTR-3B Liability</h3><div className="report-line"><span>Output GST</span><strong>₹{outputGst.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div><div className="report-line"><span>Input tax credit (on purchases)</span><strong className="text-success">- ₹{inputTaxCredit.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div><div className="report-total"><div><strong>Net GST payable</strong></div><strong>₹{Math.max(0, netGstPayable).toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div></div>
      </div>
    </>}

    {reportType === 'aging' && <>
      <div className="grid-2">
        <div className="card">
          <div className="card-header"><h3 className="card-title">Receivables Aging</h3><span className="badge badge-danger">₹{totalReceivablesDue.toLocaleString()} outstanding</span></div>
          <div className="grid-4 mb-4">
            {AGE_BUCKETS.map((bucket) => <Kpi key={bucket} title={`${bucket} days`} value={`₹${receivablesAging.totals[bucket].toLocaleString()}`} icon={AlertCircle} color={BUCKET_COLORS[bucket]} bg={BUCKET_BG[bucket]} />)}
          </div>
          <div className="table-wrap"><table className="erp-table">
            <thead><tr><th>Customer</th><th className="text-right">0-30</th><th className="text-right">31-60</th><th className="text-right">61-90</th><th className="text-right">90+</th><th className="text-right">Total Due</th></tr></thead>
            <tbody>
              {Array.from(receivablesAging.byKey.entries())
                .sort(([, a], [, b]) => AGE_BUCKETS.reduce((t, k) => t + b[k], 0) - AGE_BUCKETS.reduce((t, k) => t + a[k], 0))
                .map(([customerName, buckets]) => {
                  const rowTotal = AGE_BUCKETS.reduce((t, k) => t + buckets[k], 0);
                  return <tr key={customerName}>
                    <td style={{ fontWeight: 600 }}>{customerName}</td>
                    {AGE_BUCKETS.map((bucket) => <td key={bucket} className="text-right">{buckets[bucket] > 0 ? `₹${buckets[bucket].toLocaleString()}` : '-'}</td>)}
                    <td className="text-right font-semibold text-danger">₹{rowTotal.toLocaleString()}</td>
                  </tr>;
                })}
              {receivablesAging.byKey.size === 0 && <tr><td colSpan={6}><div className="empty-state"><p className="empty-state-title">Nothing outstanding</p><p className="empty-state-desc">Every invoice is fully paid.</p></div></td></tr>}
            </tbody>
          </table></div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="card-title">Payables Aging</h3><span className="badge badge-warning">₹{totalPayablesDue.toLocaleString()} owed</span></div>
          <div className="grid-4 mb-4">
            {AGE_BUCKETS.map((bucket) => <Kpi key={bucket} title={`${bucket} days`} value={`₹${payablesAging.totals[bucket].toLocaleString()}`} icon={AlertCircle} color={BUCKET_COLORS[bucket]} bg={BUCKET_BG[bucket]} />)}
          </div>
          <div className="table-wrap"><table className="erp-table">
            <thead><tr><th>Supplier</th><th className="text-right">0-30</th><th className="text-right">31-60</th><th className="text-right">61-90</th><th className="text-right">90+</th><th className="text-right">Total Due</th></tr></thead>
            <tbody>
              {Array.from(payablesAging.byKey.entries())
                .sort(([, a], [, b]) => AGE_BUCKETS.reduce((t, k) => t + b[k], 0) - AGE_BUCKETS.reduce((t, k) => t + a[k], 0))
                .map(([supplierName, buckets]) => {
                  const rowTotal = AGE_BUCKETS.reduce((t, k) => t + buckets[k], 0);
                  return <tr key={supplierName}>
                    <td style={{ fontWeight: 600 }}>{supplierName}</td>
                    {AGE_BUCKETS.map((bucket) => <td key={bucket} className="text-right">{buckets[bucket] > 0 ? `₹${buckets[bucket].toLocaleString()}` : '-'}</td>)}
                    <td className="text-right font-semibold text-warning">₹{rowTotal.toLocaleString()}</td>
                  </tr>;
                })}
              {payablesAging.byKey.size === 0 && <tr><td colSpan={6}><div className="empty-state"><p className="empty-state-title">Nothing owed</p><p className="empty-state-desc">Every received purchase order is fully paid.</p></div></td></tr>}
            </tbody>
          </table></div>
        </div>
      </div>
    </>}
  </div>;
}
