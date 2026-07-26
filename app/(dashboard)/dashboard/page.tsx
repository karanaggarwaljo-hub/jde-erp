'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  TrendingUp,
  DollarSign,
  ShoppingCart,
  ShoppingBag,
  PackageCheck,
  AlertTriangle,
  Users,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  Plus,
} from 'lucide-react';

const trendData = {
  '7 Days': [
    { day: 'Mon', sale: 65, pur: 40 }, { day: 'Tue', sale: 80, pur: 55 }, { day: 'Wed', sale: 45, pur: 70 },
    { day: 'Thu', sale: 95, pur: 30 }, { day: 'Fri', sale: 110, pur: 60 }, { day: 'Sat', sale: 130, pur: 45 }, { day: 'Sun', sale: 75, pur: 20 },
  ],
  '30 Days': [
    { day: 'Jun 29', sale: 238, pur: 146 }, { day: 'Jul 4', sale: 286, pur: 174 }, { day: 'Jul 9', sale: 254, pur: 158 },
    { day: 'Jul 14', sale: 321, pur: 205 }, { day: 'Jul 19', sale: 302, pur: 183 }, { day: 'Jul 24', sale: 348, pur: 214 },
  ],
  '1 Year': [
    { day: 'Aug', sale: 820, pur: 510 }, { day: 'Sep', sale: 910, pur: 580 }, { day: 'Oct', sale: 875, pur: 545 },
    { day: 'Nov', sale: 1020, pur: 630 }, { day: 'Dec', sale: 1100, pur: 690 }, { day: 'Jan', sale: 950, pur: 600 },
    { day: 'Feb', sale: 1080, pur: 650 }, { day: 'Mar', sale: 1140, pur: 710 }, { day: 'Apr', sale: 1050, pur: 640 },
    { day: 'May', sale: 1180, pur: 730 }, { day: 'Jun', sale: 1210, pur: 760 }, { day: 'Jul', sale: 1320, pur: 800 },
  ],
};

type TrendPeriod = keyof typeof trendData;

export default function DashboardPage() {
  const [activePeriod, setActivePeriod] = useState<TrendPeriod>('7 Days');
  const chartData = trendData[activePeriod];
  const chartMax = Math.ceil(Math.max(...chartData.flatMap((item) => [item.sale, item.pur])) / 10) * 10;

  const kpis = [
    { title: "Today's Sales", value: '₹1,24,500', change: '+14.2%', context: 'vs yesterday', positive: true, trend: 'up', icon: ShoppingCart, color: '#F59E0B', colorBg: 'rgba(245,158,11,0.1)' },
    { title: "Today's Purchases", value: '₹48,200', change: '-5.1%', context: 'vs yesterday', positive: true, trend: 'down', icon: ShoppingBag, color: '#3B82F6', colorBg: 'rgba(59,130,246,0.1)' },
    { title: 'Gross Profit', value: '₹36,800', change: '+18.5%', context: 'vs yesterday', positive: true, trend: 'up', icon: TrendingUp, color: '#10B981', colorBg: 'rgba(16,185,129,0.1)' },
    { title: 'Cash Balance', value: '₹3,45,000', change: '+2.4%', context: 'vs last business day', positive: true, trend: 'up', icon: DollarSign, color: '#8B5CF6', colorBg: 'rgba(139,92,246,0.1)' },
    { title: 'Inventory Value', value: '₹18,50,000', change: '840 items', context: 'across all locations', positive: true, trend: 'up', icon: PackageCheck, color: '#EC4899', colorBg: 'rgba(236,72,153,0.1)' },
    { title: 'Total Receivables', value: '₹2,15,400', change: '4 overdue', context: 'follow up today', positive: false, trend: 'down', icon: Users, color: '#F97316', colorBg: 'rgba(249,115,22,0.1)' },
    { title: 'Total Payables', value: '₹1,32,000', change: '2 due today', context: 'before close of business', positive: false, trend: 'down', icon: Clock, color: '#06B6D4', colorBg: 'rgba(6,182,212,0.1)' },
    { title: 'Low Stock Items', value: '12 parts', change: 'Action required', context: '3 critical shortages', positive: false, trend: 'down', icon: AlertTriangle, color: '#EF4444', colorBg: 'rgba(239,68,68,0.1)' },
  ];

  const attentionItems = [
    { label: 'Receivables overdue', detail: '₹86,400 across 4 customers', href: '/customers', tone: 'warning' },
    { label: 'Payments due today', detail: '₹42,000 payable to 2 suppliers', href: '/purchases', tone: 'info' },
    { label: 'Critical stock shortages', detail: '3 parts need a reorder now', href: '/inventory', tone: 'danger' },
  ];

  const recentActivities = [
    { time: '10 mins ago', title: 'Invoice #INV-1042 generated', desc: 'Sharma Auto Works - ₹18,400', type: 'sale' },
    { time: '25 mins ago', title: 'Goods Received Note #GRN-1008', desc: 'Bosch India Ltd - 45 Brake Pads', type: 'purchase' },
    { time: '1 hour ago', title: 'Payment Received #PAY-1019', desc: 'City Motors Garage - ₹35,000 (UPI)', type: 'payment' },
    { time: '2 hours ago', title: 'Low Stock Alert', desc: 'Maruti Alternator Belt (SP-006) - 3 units left', type: 'alert' },
    { time: '3 hours ago', title: 'New Quotation #QT-1015', desc: 'Kumar Spare Parts - ₹8,200', type: 'quotation' },
  ];

  const lowStockProducts = [
    { code: 'SP-006', name: 'Alternator Belt', brand: 'Gates', stock: 3, min: 8, location: 'D-02' },
    { code: 'SP-004', name: 'Clutch Plate', brand: 'LUK', stock: 2, min: 5, location: 'C-02' },
    { code: 'SP-007', name: 'Shock Absorber - Rear', brand: 'Gabriel', stock: 3, min: 6, location: 'E-01' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Executive Dashboard</h1>
          <p className="page-subtitle">Real-time performance metrics for Jai Durga Enterprises</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <a className="btn btn-secondary" href="/api/export?type=dashboard" download>Download Summary</a>
          <Link href="/sales" className="btn btn-primary">
            <Plus size={16} /> New Sale Invoice
          </Link>
        </div>
      </div>

      <section className="attention-section" aria-labelledby="attention-heading">
        <div className="attention-heading">
          <div>
            <p className="eyebrow">Priority queue</p>
            <h2 id="attention-heading">Needs attention today</h2>
          </div>
          <span className="badge badge-danger">3 priorities</span>
        </div>
        <div className="attention-grid">
          {attentionItems.map((item) => (
            <Link key={item.label} href={item.href} className={`attention-item ${item.tone}`}>
              <div>
                <p>{item.label}</p>
                <span>{item.detail}</span>
              </div>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>

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
                {kpi.trend === 'up' ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
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
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{activePeriod} comparison · amounts in ₹ thousands</p>
            </div>
            <div className="tabs period-tabs" aria-label="Sales chart period">
              {(Object.keys(trendData) as TrendPeriod[]).map((period) => (
                <button key={period} className={`tab ${activePeriod === period ? 'active' : ''}`} onClick={() => setActivePeriod(period)} aria-pressed={activePeriod === period}>
                  {period}
                </button>
              ))}
            </div>
          </div>

          <div className="dashboard-chart" role="img" aria-label={`${activePeriod} sales and purchases bar chart, values in thousands of rupees`}>
            {chartData.map((item) => (
              <div key={item.day} className="chart-column">
                <div className="chart-bars">
                  <div className="chart-bar sales-bar" style={{ height: `${(item.sale / chartMax) * 100}%` }} title={`Sales: ₹${item.sale}k`} />
                  <div className="chart-bar purchases-bar" style={{ height: `${(item.pur / chartMax) * 100}%` }} title={`Purchases: ₹${item.pur}k`} />
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
            <span className="badge badge-danger">3 items</span>
          </div>
          <div className="low-stock-list">
            {lowStockProducts.map((product) => (
              <div key={product.code} className="low-stock-item">
                <div className="flex justify-between items-center mb-1">
                  <span style={{ fontWeight: 600, fontSize: '13px' }}>{product.name}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Loc: {product.location}</span>
                </div>
                <div className="flex justify-between items-center" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  <span>Code: {product.code} ({product.brand})</span>
                  <span className="text-danger font-semibold">{product.stock} / min {product.min}</span>
                </div>
                <span className="reorder-quantity">Recommended reorder: {product.min * 2 - product.stock} units</span>
              </div>
            ))}
          </div>
          <Link href="/purchases" className="btn btn-secondary btn-sm w-full mt-4" style={{ justifyContent: 'center' }}>
            Review reorder PO for 3 critical parts <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Recent Real-Time Activity</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Latest sales, stock, and payment events</p>
          </div>
          <Link href="/reports" className="btn btn-ghost btn-sm">View reports <ArrowRight size={14} /></Link>
        </div>
        <div className="table-wrap">
          <table className="erp-table">
            <thead><tr><th>Time</th><th>Activity</th><th>Details</th><th>Status</th></tr></thead>
            <tbody>
              {recentActivities.map((activity) => (
                <tr key={`${activity.time}-${activity.title}`}>
                  <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{activity.time}</td>
                  <td style={{ fontWeight: 600 }}>{activity.title}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{activity.desc}</td>
                  <td><span className={`badge ${activity.type === 'sale' ? 'badge-success' : activity.type === 'purchase' ? 'badge-info' : activity.type === 'alert' ? 'badge-danger' : 'badge-warning'}`}>{activity.type.toUpperCase()}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
