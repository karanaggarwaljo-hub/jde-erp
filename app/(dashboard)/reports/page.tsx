'use client';

import { useState } from 'react';
import { FileText, Download, Printer, Filter, Calendar } from 'lucide-react';

export default function ReportsPage() {
  const [reportType, setReportType] = useState<'pnl' | 'sales' | 'stock' | 'gst'>('pnl');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Financial & Operational Reports</h1>
          <p className="page-subtitle">Generate P&L statements, GST filing summaries, Stock valuation and sales audit reports</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-secondary">
            <Printer size={16} /> Print Report
          </button>
          <button className="btn btn-primary">
            <Download size={16} /> Export CSV / Excel
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs mb-6">
        <button className={`tab ${reportType === 'pnl' ? 'active' : ''}`} onClick={() => setReportType('pnl')}>
          Profit & Loss Statement
        </button>
        <button className={`tab ${reportType === 'sales' ? 'active' : ''}`} onClick={() => setReportType('sales')}>
          Sales Summary Report
        </button>
        <button className={`tab ${reportType === 'stock' ? 'active' : ''}`} onClick={() => setReportType('stock')}>
          Stock Valuation Report
        </button>
        <button className={`tab ${reportType === 'gst' ? 'active' : ''}`} onClick={() => setReportType('gst')}>
          GST Summary (GSTR-1 & GSTR-3B)
        </button>
      </div>

      {/* Report Content Container */}
      {reportType === 'pnl' && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Profit & Loss Statement (July 2026)</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Jai Durga Enterprises — Provisional Financials</p>
            </div>
            <span className="badge badge-success">Balanced</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '600px', margin: '0 auto', padding: '20px 0' }}>
            <div className="flex justify-between items-center" style={{ borderBottom: '1px dashed var(--border-default)', paddingBottom: '8px' }}>
              <span style={{ fontWeight: 600, fontSize: '15px' }}>Total Sales Revenue</span>
              <span style={{ fontWeight: 700, fontSize: '16px', color: 'var(--color-success)' }}>₹ 4,85,000</span>
            </div>

            <div className="flex justify-between items-center" style={{ paddingLeft: '16px', color: 'var(--text-secondary)' }}>
              <span>Less: Cost of Goods Sold (COGS)</span>
              <span>- ₹ 2,90,000</span>
            </div>

            <div className="flex justify-between items-center" style={{ borderBottom: '1px solid var(--border-default)', paddingBottom: '8px', paddingTop: '4px' }}>
              <span style={{ fontWeight: 700, fontSize: '15px' }}>Gross Profit Margin</span>
              <span style={{ fontWeight: 800, fontSize: '17px', color: 'var(--brand-primary)' }}>₹ 1,95,000</span>
            </div>

            <div className="flex justify-between items-center" style={{ paddingLeft: '16px', color: 'var(--text-secondary)' }}>
              <span>Operating Expenses (Rent, Salaries, Utilities, Transport)</span>
              <span>- ₹ 83,050</span>
            </div>

            <div className="flex justify-between items-center" style={{ background: 'var(--bg-elevated)', padding: '16px', borderRadius: 'var(--radius-md)', borderLeft: '4px solid var(--color-success)' }}>
              <div>
                <span style={{ fontWeight: 800, fontSize: '16px', display: 'block' }}>Net Operating Profit</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>After deducting COGS and all operational costs</span>
              </div>
              <span style={{ fontWeight: 800, fontSize: '22px', color: 'var(--color-success)' }}>
                ₹ 1,11,950
              </span>
            </div>
          </div>
        </div>
      )}

      {reportType === 'stock' && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Warehouse Inventory Valuation Summary</h3>
            <span className="badge badge-info">840 Total Units</span>
          </div>
          <div className="table-wrap">
            <table className="erp-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Product Count</th>
                  <th>Stock Quantity</th>
                  <th className="text-right">Cost Value (₹)</th>
                  <th className="text-right">Retail Value (₹)</th>
                  <th className="text-right">Expected Margin (₹)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Brakes</td>
                  <td>12 Items</td>
                  <td>145 Pcs</td>
                  <td className="text-right">₹ 2,45,000</td>
                  <td className="text-right">₹ 3,80,000</td>
                  <td className="text-right text-success">₹ 1,35,000</td>
                </tr>
                <tr>
                  <td>Filters</td>
                  <td>24 Items</td>
                  <td>380 Pcs</td>
                  <td className="text-right">₹ 1,80,000</td>
                  <td className="text-right">₹ 3,20,000</td>
                  <td className="text-right text-success">₹ 1,40,000</td>
                </tr>
                <tr>
                  <td>Engine & Clutch</td>
                  <td>18 Items</td>
                  <td>95 Pcs</td>
                  <td className="text-right">₹ 6,50,000</td>
                  <td className="text-right">₹ 9,20,000</td>
                  <td className="text-right text-success">₹ 2,70,000</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
