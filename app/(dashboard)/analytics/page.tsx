'use client';

import { useState } from 'react';
import { BarChart3, TrendingUp, Sparkles, PieChart, Activity, Zap } from 'lucide-react';

export default function AnalyticsPage() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Analytics & AI Demand Forecasting</h1>
          <p className="page-subtitle">Predictive stock replenishment, sales trends and spare part velocity analytics</p>
        </div>
        <button className="btn btn-primary" style={{ gap: '8px' }}>
          <Sparkles size={16} /> Run AI Forecast Model
        </button>
      </div>

      {/* AI Demand Prediction Hero Banner */}
      <div className="card mb-6" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.12), rgba(139,92,246,0.1))', borderColor: 'rgba(245,158,11,0.3)' }}>
        <div className="flex items-start gap-4">
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'linear-gradient(135deg, #F59E0B, #F97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', flexShrink: 0 }}>
            <Sparkles size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 style={{ fontSize: '17px', fontWeight: 700 }}>AI Stock Reorder Recommendation (Next 30 Days)</h3>
              <span className="badge badge-warning">High Accuracy Model</span>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Based on seasonal velocity & historical sales data, <strong>Maruti Alternator Belts (SP-006)</strong> and <strong>Toyota Clutch Plates (SP-004)</strong> are predicted to run out of stock in 6 days. Recommended PO size: 25 Pcs.
            </p>
            <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
              <button className="btn btn-primary btn-sm">Auto-Generate Purchase Orders</button>
              <button className="btn btn-ghost btn-sm">View Model Parameters</button>
            </div>
          </div>
        </div>
      </div>

      {/* Analytics Grid */}
      <div className="grid-2 mb-6">
        {/* Top Selling Products */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Top 5 Best Selling Spare Parts</h3>
            <span className="badge badge-success">By Volume</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {[
              { code: 'SP-001', name: 'Brake Pad Set - Front', brand: 'Bosch', sold: 142, revenue: '₹1,56,200' },
              { code: 'SP-003', name: 'Oil Filter', brand: 'Mann', sold: 210, revenue: '₹63,000' },
              { code: 'SP-002', name: 'Air Filter - Premium', brand: 'Denso', sold: 98, revenue: '₹56,840' },
              { code: 'SP-005', name: 'Spark Plug Set (4pcs)', brand: 'NGK', sold: 64, revenue: '₹62,720' },
              { code: 'SP-004', name: 'Clutch Plate', brand: 'LUK', sold: 18, revenue: '₹75,600' },
            ].map((prod, i) => (
              <div key={i} className="flex justify-between items-center" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
                <div className="flex items-center gap-3">
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, color: 'var(--brand-primary)' }}>
                    #{i + 1}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '13.5px' }}>{prod.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{prod.code} • {prod.brand}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div style={{ fontWeight: 700 }}>{prod.revenue}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{prod.sold} units sold</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sales by Category */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Category Revenue Mix</h3>
            <span className="badge badge-info">July 2026</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {[
              { category: 'Brakes & Friction', share: 38, amount: '₹1,84,300', color: '#F59E0B' },
              { category: 'Engine Parts', share: 26, amount: '₹1,26,100', color: '#3B82F6' },
              { category: 'Filters & Fluids', share: 20, amount: '₹97,000', color: '#10B981' },
              { category: 'Clutch & Transmission', share: 16, amount: '₹77,600', color: '#8B5CF6' },
            ].map((cat, i) => (
              <div key={i}>
                <div className="flex justify-between items-center mb-1" style={{ fontSize: '13px' }}>
                  <span style={{ fontWeight: 600 }}>{cat.category}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{cat.amount} ({cat.share}%)</span>
                </div>
                <div style={{ width: '100%', height: '8px', background: 'var(--bg-elevated)', borderRadius: '100px', overflow: 'hidden' }}>
                  <div style={{ width: `${cat.share}%`, height: '100%', background: cat.color, borderRadius: '100px' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
