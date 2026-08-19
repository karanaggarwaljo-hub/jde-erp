'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  TrendingUp,
  ShoppingCart,
  ShoppingBag,
  PackageCheck,
  AlertTriangle,
  Users,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
} from 'lucide-react';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { useCompany } from '@/components/CompanyProvider';

type Product = { id: string; part_number: string; name: string; brand: string; category: string; cost_price: number; current_stock: number; min_stock: number; location: string };
type Customer = { id: string; balance: number };
type Supplier = { id: string; name: string; balance: number };
type Invoice = { id: string; customer: string; date: string; total: number; paid: number };
type PurchaseOrder = { id: string; supplier: string; date: string; total: number };
type Grn = { id: string; po_number: string; supplier: string; received_at: string };
type Quotation = { id: string; customer: string; date: string; total: number };

type TrendPeriod = '7 Days' | '30 Days' | '1 Year';

function isoDate(d: Date) {
  return d.toISOString().split('T')[0];
}

function daysAgoDate(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function sumInRange(rows: Array<{ date: string; total: number }>, from: string, to: string) {
  return rows.filter((r) => r.date >= from && r.date <= to).reduce((t, r) => t + Number(r.total || 0), 0);
}

function pctChange(current: number, previous: number): { label: string; positive: boolean } {
  if (previous === 0) {
    return current > 0 ? { label: 'new activity', positive: true } : { label: 'no change', positive: true };
  }
  const change = ((current - previous) / previous) * 100;
  return { label: `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`, positive: change >= 0 };
}

export default function DashboardPage() {
  const { configError } = useCompany();
  const { rows: products } = useCompanyTable<Product>('products');
  const { rows: customers } = useCompanyTable<Customer>('customers');
  const { rows: suppliers } = useCompanyTable<Supplier>('suppliers');
  const { rows: invoices } = useCompanyTable<Invoice>('invoices');
  const { rows: purchaseOrders } = useCompanyTable<PurchaseOrder>('purchase_orders');
  const { rows: grns } = useCompanyTable<Grn>('grns');
  const { rows: quotations } = useCompanyTable<Quotation>('quotations');

  const [activePeriod, setActivePeriod] = useState<TrendPeriod>('7 Days');

  const today = isoDate(new Date());
  const yesterday = isoDate(daysAgoDate(1));

  const todaySales = sumInRange(invoices, today, today);
  const yesterdaySales = sumInRange(invoices, yesterday, yesterday);
  const todayPurchases = sumInRange(purchaseOrders, today, today);
  const yesterdayPurchases = sumInRange(purchaseOrders, yesterday, yesterday);

  const revenue30 = sumInRange(invoices, isoDate(daysAgoDate(29)), today);
  const revenuePrev30 = sumInRange(invoices, isoDate(daysAgoDate(59)), isoDate(daysAgoDate(30)));
  const spend30 = sumInRange(purchaseOrders, isoDate(daysAgoDate(29)), today);
  const spendPrev30 = sumInRange(purchaseOrders, isoDate(daysAgoDate(59)), isoDate(daysAgoDate(30)));

  const lowStockProducts = products.filter((p) => Number(p.min_stock) > 0 && Number(p.current_stock) <= Number(p.min_stock));
  const inventoryValue = products.reduce((t, p) => t + Number(p.current_stock || 0) * Number(p.cost_price || 0), 0);
  const totalReceivables = customers.reduce((t, c) => t + Number(c.balance || 0), 0);
  const totalPayables = suppliers.reduce((t, s) => t + Number(s.balance || 0), 0);
  const overdueCustomerCount = customers.filter((c) => Number(c.balance) > 0).length;
  const payableSupplierCount = suppliers.filter((s) => Number(s.balance) > 0).length;

  const salesChange = pctChange(todaySales, yesterdaySales);
  const purchasesChange = pctChange(todayPurchases, yesterdayPurchases);
  const revenueChange = pctChange(revenue30, revenuePrev30);
  const spendChange = pctChange(spend30, spendPrev30);

  const kpis = [
    { title: "Today's Sales", value: `₹${todaySales.toLocaleString()}`, change: salesChange.label, context: 'vs yesterday', positive: salesChange.positive, icon: ShoppingCart, color: 'var(--chart-amber)', colorBg: 'var(--amber-tint)' },
    { title: "Today's Purchases", value: `₹${todayPurchases.toLocaleString()}`, change: purchasesChange.label, context: 'vs yesterday', positive: purchasesChange.positive, icon: ShoppingBag, color: 'var(--chart-blue)', colorBg: 'var(--color-info-bg)' },
    { title: 'Revenue (30 Days)', value: `₹${revenue30.toLocaleString()}`, change: revenueChange.label, context: 'vs prior 30 days', positive: revenueChange.positive, icon: TrendingUp, color: 'var(--chart-green)', colorBg: 'var(--em-tint)' },
    { title: 'Purchase Spend (30 Days)', value: `₹${spend30.toLocaleString()}`, change: spendChange.label, context: 'vs prior 30 days', positive: spend30 <= spendPrev30, icon: ShoppingBag, color: 'var(--chart-violet)', colorBg: 'rgba(109,40,217,0.1)' },
    { title: 'Inventory Value', value: `₹${inventoryValue.toLocaleString()}`, change: `${products.length} parts`, context: 'at cost price', positive: true, icon: PackageCheck, color: 'var(--chart-pink)', colorBg: 'rgba(190,24,93,0.1)' },
    { title: 'Total Receivables', value: `₹${totalReceivables.toLocaleString()}`, change: `${overdueCustomerCount} outstanding`, context: 'follow up soon', positive: overdueCustomerCount === 0, icon: Users, color: 'var(--chart-orange)', colorBg: 'rgba(194,65,12,0.1)' },
    { title: 'Total Payables', value: `₹${totalPayables.toLocaleString()}`, change: `${payableSupplierCount} outstanding`, context: 'to suppliers', positive: payableSupplierCount === 0, icon: Clock, color: 'var(--chart-teal)', colorBg: 'rgba(14,116,144,0.1)' },
    { title: 'Low Stock Items', value: `${lowStockProducts.length} parts`, change: lowStockProducts.length > 0 ? 'Action required' : 'All stocked', context: `${lowStockProducts.length} at or below minimum`, positive: lowStockProducts.length === 0, icon: AlertTriangle, color: 'var(--chart-red)', colorBg: 'var(--rose-tint)' },
  ];

  const recentActivities = useMemo(() => {
    const events: Array<{ date: string; title: string; desc: string; type: string }> = [];
    for (const inv of invoices) events.push({ date: inv.date, title: `Invoice #${inv.id} generated`, desc: `${inv.customer} - ₹${Number(inv.total).toLocaleString()}`, type: 'sale' });
    for (const grn of grns) events.push({ date: grn.received_at.split(' ')[0] || grn.received_at, title: `Goods Received Note #${grn.id}`, desc: `${grn.supplier} - Ref ${grn.po_number}`, type: 'purchase' });
    for (const po of purchaseOrders) events.push({ date: po.date, title: `Purchase Order #${po.id} sent`, desc: `${po.supplier} - ₹${Number(po.total).toLocaleString()}`, type: 'purchase' });
    for (const q of quotations) events.push({ date: q.date, title: `Quotation #${q.id}`, desc: `${q.customer} - ₹${Number(q.total).toLocaleString()}`, type: 'quotation' });
    for (const p of lowStockProducts) events.push({ date: today, title: 'Low Stock Alert', desc: `${p.name} (${p.part_number}) - ${p.current_stock} units left`, type: 'alert' });
    return events.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  }, [invoices, grns, purchaseOrders, quotations, lowStockProducts, today]);

  const chartData = useMemo(() => {
    if (activePeriod === '7 Days') {
      return Array.from({ length: 7 }, (_, i) => {
        const d = daysAgoDate(6 - i);
        const iso = isoDate(d);
        return { day: d.toLocaleDateString('en-IN', { weekday: 'short' }), sale: sumInRange(invoices, iso, iso), pur: sumInRange(purchaseOrders, iso, iso) };
      });
    }
    if (activePeriod === '30 Days') {
      return Array.from({ length: 6 }, (_, i) => {
        const bucketStart = daysAgoDate(29 - i * 5);
        const bucketEnd = daysAgoDate(Math.max(0, 25 - i * 5));
        const from = isoDate(bucketStart);
        const to = isoDate(bucketEnd);
        return { day: bucketStart.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }), sale: sumInRange(invoices, from, to), pur: sumInRange(purchaseOrders, from, to) };
      });
    }
    return Array.from({ length: 12 }, (_, i) => {
      const monthDate = new Date();
      monthDate.setMonth(monthDate.getMonth() - (11 - i));
      const from = isoDate(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1));
      const to = isoDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0));
      return { day: monthDate.toLocaleDateString('en-IN', { month: 'short' }), sale: sumInRange(invoices, from, to), pur: sumInRange(purchaseOrders, from, to) };
    });
  }, [activePeriod, invoices, purchaseOrders]);

  const chartMax = Math.max(1, Math.ceil(Math.max(...chartData.flatMap((item) => [item.sale, item.pur])) / 1000) * 1000);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Executive Dashboard</h1>
          <p className="page-subtitle">Real-time performance metrics for the active company</p>
        </div>
      </div>

      {configError && (
        <div className="alert alert-danger mb-4" role="alert">
          Can&apos;t reach the database right now — {configError}
        </div>
      )}

      {!configError && (
      <>
      <div className="kpi-grid">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.title} className="kpi-card" style={{ '--kpi-color': kpi.color, '--kpi-color-bg': kpi.colorBg } as React.CSSProperties}>
              <div className="flex justify-between items-center">
                <span className="kpi-label">{kpi.title}</span>
                <div className="kpi-icon-wrap"><Icon size={18} /></div>
              </div>
              <div className="kpi-value">{kpi.value}</div>
              <div className={`kpi-change ${kpi.positive ? 'positive' : 'negative'}`}>
                {kpi.positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                <span>{kpi.change}</span>
              </div>
              <span className="kpi-context">{kpi.context}</span>
            </div>
          );
        })}
      </div>

      <div className="dashboard-split mb-6">
        <div className="card">
          <div className="card-header dashboard-chart-header">
            <div>
              <h3 className="card-title">Sales vs Purchases</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{activePeriod} comparison · amounts in ₹</p>
            </div>
            <div className="tabs period-tabs" aria-label="Sales chart period">
              {(['7 Days', '30 Days', '1 Year'] as TrendPeriod[]).map((period) => (
                <button key={period} className={`tab ${activePeriod === period ? 'active' : ''}`} onClick={() => setActivePeriod(period)} aria-pressed={activePeriod === period}>
                  {period}
                </button>
              ))}
            </div>
          </div>

          <div className="dashboard-chart" role="img" aria-label={`${activePeriod} sales and purchases bar chart, values in rupees`}>
            {chartData.map((item, index) => (
              <div key={`${item.day}-${index}`} className="chart-column">
                <div className="chart-bars">
                  <div className="chart-bar sales-bar" style={{ height: `${(item.sale / chartMax) * 100}%` }} title={`Sales: ₹${item.sale.toLocaleString()}`} />
                  <div className="chart-bar purchases-bar" style={{ height: `${(item.pur / chartMax) * 100}%` }} title={`Purchases: ₹${item.pur.toLocaleString()}`} />
                </div>
                <span>{item.day}</span>
              </div>
            ))}
          </div>
          <div className="chart-legend">
            <div><i className="legend-dot sales-dot" />Sales Revenue</div>
            <div><i className="legend-dot purchases-dot" />Purchases Expense</div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Critical Low Stock</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Below their minimum stock threshold</p>
            </div>
            <span className="badge badge-danger">{lowStockProducts.length} items</span>
          </div>
          <div className="low-stock-list">
            {lowStockProducts.length === 0 && <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No parts are below their minimum stock.</p>}
            {lowStockProducts.map((product) => (
              <div key={product.id} className="low-stock-item">
                <div className="flex justify-between items-center mb-1">
                  <span style={{ fontWeight: 600, fontSize: '13px' }}>{product.name}</span>
                  <span className="badge badge-info">{product.category}</span>
                </div>
                <div className="flex justify-between items-center" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  <span>Code: {product.part_number} ({product.brand}) · Loc: {product.location}</span>
                  <span className="text-danger font-semibold">{product.current_stock} / min {product.min_stock}</span>
                </div>
                <span className="reorder-quantity">Recommended reorder: {Math.max(0, product.min_stock * 2 - product.current_stock)} units</span>
              </div>
            ))}
          </div>
          {lowStockProducts.length > 0 && (
            <Link href="/purchases" className="btn btn-secondary btn-sm w-full mt-4" style={{ justifyContent: 'center' }}>
              Review reorder PO for {lowStockProducts.length} critical part(s) <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Recent Activity</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Latest sales, stock, and purchase events</p>
          </div>
          <Link href="/reports" className="btn btn-ghost btn-sm">View reports <ArrowRight size={14} /></Link>
        </div>
        <div className="table-wrap">
          <table className="erp-table">
            <thead><tr><th>Date</th><th>Activity</th><th>Details</th><th>Status</th></tr></thead>
            <tbody>
              {recentActivities.map((activity, index) => (
                <tr key={`${activity.date}-${activity.title}-${index}`}>
                  <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{activity.date}</td>
                  <td style={{ fontWeight: 600 }}>{activity.title}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{activity.desc}</td>
                  <td><span className={`badge ${activity.type === 'sale' ? 'badge-success' : activity.type === 'purchase' ? 'badge-info' : activity.type === 'alert' ? 'badge-danger' : 'badge-warning'}`}>{activity.type.toUpperCase()}</span></td>
                </tr>
              ))}
              {recentActivities.length === 0 && (
                <tr><td colSpan={4}><div className="empty-state"><p className="empty-state-title">No activity yet</p><p className="empty-state-desc">Sales, purchases, and stock events will appear here.</p></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
