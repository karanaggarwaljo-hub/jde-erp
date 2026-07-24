'use client';

import { useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  ShoppingCart,
  ShoppingBag,
  PackageCheck,
  AlertTriangle,
  Users,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Plus
} from 'lucide-react';

export default function DashboardPage() {
  const kpis = [
    { title: "Today's Sales", value: '₹1,24,500', change: '+14.2%', positive: true, icon: ShoppingCart, color: '#F59E0B', colorBg: 'rgba(245,158,11,0.1)' },
    { title: "Today's Purchases", value: '₹48,200', change: '-5.1%', positive: false, icon: ShoppingBag, color: '#3B82F6', colorBg: 'rgba(59,130,246,0.1)' },
    { title: 'Gross Profit', value: '₹36,800', change: '+18.5%', positive: true, icon: TrendingUp, color: '#10B981', colorBg: 'rgba(16,185,129,0.1)' },
    { title: 'Cash Balance', value: '₹3,45,000', change: '+2.4%', positive: true, icon: DollarSign, color: '#8B5CF6', colorBg: 'rgba(139,92,246,0.1)' },
    { title: 'Inventory Value', value: '₹18,50,000', change: '840 items', positive: true, icon: PackageCheck, color: '#EC4899', colorBg: 'rgba(236,72,153,0.1)' },
    { title: 'Total Receivables', value: '₹2,15,400', change: '4 Overdue', positive: false, icon: Users, color: '#F97316', colorBg: 'rgba(249,115,22,0.1)' },
    { title: 'Total Payables', value: '₹1,32,000', change: '2 Due Today', positive: false, icon: Clock, color: '#06B6D4', colorBg: 'rgba(6,182,212,0.1)' },
    { title: 'Low Stock Items', value: '12 Parts', change: 'Action Req', positive: false, icon: AlertTriangle, color: '#EF4444', colorBg: 'rgba(239,68,68,0.1)' },
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
    { code: 'SP-004', name: 'Clutch Plate', brand: 'LUK', stock: 8, min: 5, location: 'C-02' },
    { code: 'SP-007', name: 'Shock Absorber - Rear', brand: 'Gabriel', stock: 12, min: 5, location: 'E-01' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Executive Dashboard</h1>
          <p className="page-subtitle">Real-time performance metrics for Jai Durga Enterprises</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-secondary">Download Summary</button>
          <button className="btn btn-primary">
            <Plus size={16} /> New Sale Invoice
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="kpi-grid">
        {kpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <div key={idx} className="kpi-card" style={{ '--kpi-color': kpi.color, '--kpi-color-bg': kpi.colorBg } as React.CSSProperties}>
              <div className="flex justify-between items-center">
                <span className="kpi-label">{kpi.title}</span>
                <div className="kpi-icon-wrap">
                  <Icon size={18} />
                </div>
              </div>
              <div className="kpi-value">{kpi.value}</div>
              <div className={`kpi-change ${kpi.positive ? 'positive' : 'negative'}`}>
                {kpi.positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                <span>{kpi.change}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Charts & Details Section */}
      <div className="grid-3 mb-6" style={{ gridTemplateColumns: '2fr 1fr' }}>
        {/* Sales Trend Card */}
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Weekly Sales vs Purchases</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Comparison of revenue and procurement expenses</p>
            </div>
            <div className="tabs">
              <button className="tab active">7 Days</button>
              <button className="tab">30 Days</button>
              <button className="tab">1 Year</button>
            </div>
          </div>

          <div style={{ height: '240px', display: 'flex', alignItems: 'flex-end', gap: '16px', padding: '20px 10px 10px 10px' }}>
            {[
              { day: 'Mon', sale: 65, pur: 40 },
              { day: 'Tue', sale: 80, pur: 55 },
              { day: 'Wed', sale: 45, pur: 70 },
              { day: 'Thu', sale: 95, pur: 30 },
              { day: 'Fri', sale: 110, pur: 60 },
              { day: 'Sat', sale: 130, pur: 45 },
              { day: 'Sun', sale: 75, pur: 20 },
            ].map((item, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', height: '100%', justifyContent: 'flex-end' }}>
                <div style={{ width: '100%', display: 'flex', gap: '4px', alignItems: 'flex-end', height: '180px' }}>
                  <div
                    style={{
                      height: `${(item.sale / 140) * 100}%`,
                      flex: 1,
                      background: 'linear-gradient(to top, #F59E0B, #FCD34D)',
                      borderRadius: '4px 4px 0 0',
                    }}
                    title={`Sales: ₹${item.sale}k`}
                  />
                  <div
                    style={{
                      height: `${(item.pur / 140) * 100}%`,
                      flex: 1,
                      background: 'linear-gradient(to top, #3B82F6, #60A5FA)',
                      borderRadius: '4px 4px 0 0',
                    }}
                    title={`Purchases: ₹${item.pur}k`}
                  />
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.day}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between" style={{ padding: '8px 12px 0 12px', borderTop: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center gap-2">
              <div style={{ width: '10px', height: '10px', background: '#F59E0B', borderRadius: '2px' }} />
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Sales Revenue</span>
            </div>
            <div className="flex items-center gap-2">
              <div style={{ width: '10px', height: '10px', background: '#3B82F6', borderRadius: '2px' }} />
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Purchases Expense</span>
            </div>
          </div>
        </div>

        {/* Low Stock Alerts */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Critical Low Stock</h3>
            <span className="badge badge-danger">3 Items</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {lowStockProducts.map((p, idx) => (
              <div key={idx} style={{ padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid var(--color-danger)' }}>
                <div className="flex justify-between items-center mb-1">
                  <span style={{ fontWeight: 600, fontSize: '13px' }}>{p.name}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Loc: {p.location}</span>
                </div>
                <div className="flex justify-between items-center" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  <span>Code: {p.code} ({p.brand})</span>
                  <span className="text-danger font-semibold">{p.stock} / min {p.min}</span>
                </div>
              </div>
            ))}
          </div>

          <button className="btn btn-secondary btn-sm w-full mt-4" style={{ justifyContent: 'center' }}>
            Create Reorder PO
          </button>
        </div>
      </div>

      {/* Recent Activity Feed */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Recent Real-Time Activity</h3>
          <button className="btn btn-ghost btn-sm">View All Logs</button>
        </div>

        <div className="table-wrap">
          <table className="erp-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Activity</th>
                <th>Details</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recentActivities.map((act, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{act.time}</td>
                  <td style={{ fontWeight: 600 }}>{act.title}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{act.desc}</td>
                  <td>
                    <span className={`badge ${act.type === 'sale' ? 'badge-success' : act.type === 'purchase' ? 'badge-info' : act.type === 'alert' ? 'badge-danger' : 'badge-warning'}`}>
                      {act.type.toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
