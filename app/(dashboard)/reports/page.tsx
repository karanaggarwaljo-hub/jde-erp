'use client';

import { useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { printCurrentPage } from '@/lib/client-export';

type ReportType = 'pnl' | 'sales' | 'stock' | 'gst';

const salesRows = [
  ['INV-1042', 'Sharma Auto Works', '2026-07-23', 18400, 'Paid'],
  ['INV-1041', 'City Motors Garage', '2026-07-22', 42500, 'Partial'],
  ['INV-1040', 'Kumar Spare Parts', '2026-07-21', 8200, 'Unpaid'],
];

const stockRows = [
  ['Brakes', '12 Items', '145 Pcs', 245000, 380000, 135000],
  ['Filters', '24 Items', '380 Pcs', 180000, 320000, 140000],
  ['Engine & Clutch', '18 Items', '95 Pcs', 650000, 920000, 270000],
];

export default function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>('pnl');
  const [feedback, setFeedback] = useState('');

  return <div>
    <div className="page-header"><div><h1 className="page-title">Financial & Operational Reports</h1><p className="page-subtitle">Generate P&L statements, GST filing summaries, stock valuation and sales audit reports</p></div><div className="flex gap-2"><button className="btn btn-secondary" onClick={printCurrentPage}><Printer size={16} /> Print Report</button><a className="btn btn-primary" href={`/api/export?type=${reportType}`} download onClick={() => setFeedback('Report export started.')}><Download size={16} /> Export CSV</a></div></div>
    {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}
    <div className="tabs mb-6 report-tabs"><button className={`tab ${reportType === 'pnl' ? 'active' : ''}`} onClick={() => setReportType('pnl')}>Profit & Loss</button><button className={`tab ${reportType === 'sales' ? 'active' : ''}`} onClick={() => setReportType('sales')}>Sales Summary</button><button className={`tab ${reportType === 'stock' ? 'active' : ''}`} onClick={() => setReportType('stock')}>Stock Valuation</button><button className={`tab ${reportType === 'gst' ? 'active' : ''}`} onClick={() => setReportType('gst')}>GST Summary</button></div>

    {reportType === 'pnl' && <div className="card"><div className="card-header"><div><h3 className="card-title">Profit & Loss Statement (July 2026)</h3><p className="text-muted text-sm">Jai Durga Enterprises — Provisional Financials</p></div><span className="badge badge-success">Balanced</span></div><div className="report-summary">
      <div className="report-line report-strong"><span>Total Sales Revenue</span><strong className="text-success">₹4,85,000</strong></div><div className="report-line indent"><span>Less: Cost of Goods Sold (COGS)</span><span>- ₹2,90,000</span></div><div className="report-line report-strong"><span>Gross Profit Margin</span><strong className="text-brand">₹1,95,000</strong></div><div className="report-line indent"><span>Operating Expenses</span><span>- ₹83,050</span></div><div className="report-total"><div><strong>Net Operating Profit</strong><small>After COGS and operational costs</small></div><strong>₹1,11,950</strong></div>
    </div></div>}

    {reportType === 'sales' && <div className="card"><div className="card-header"><h3 className="card-title">Sales Summary (July 2026)</h3><span className="badge badge-info">3 recent invoices</span></div><div className="table-wrap"><table className="erp-table"><thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th className="text-right">Amount</th><th>Status</th></tr></thead><tbody>{salesRows.map((row) => <tr key={String(row[0])}><td className="text-brand font-semibold">{row[0]}</td><td>{row[1]}</td><td className="text-muted">{row[2]}</td><td className="text-right font-semibold">₹{Number(row[3]).toLocaleString()}</td><td><span className={`badge ${row[4] === 'Paid' ? 'badge-success' : row[4] === 'Partial' ? 'badge-warning' : 'badge-danger'}`}>{row[4]}</span></td></tr>)}</tbody></table></div></div>}

    {reportType === 'stock' && <div className="card"><div className="card-header"><h3 className="card-title">Warehouse Inventory Valuation Summary</h3><span className="badge badge-info">840 Total Units</span></div><div className="table-wrap"><table className="erp-table"><thead><tr><th>Category</th><th>Product Count</th><th>Stock Quantity</th><th className="text-right">Cost Value</th><th className="text-right">Retail Value</th><th className="text-right">Expected Margin</th></tr></thead><tbody>{stockRows.map((row) => <tr key={String(row[0])}><td>{row[0]}</td><td>{row[1]}</td><td>{row[2]}</td><td className="text-right">₹{Number(row[3]).toLocaleString()}</td><td className="text-right">₹{Number(row[4]).toLocaleString()}</td><td className="text-right text-success">₹{Number(row[5]).toLocaleString()}</td></tr>)}</tbody></table></div></div>}

    {reportType === 'gst' && <div className="grid-2"><div className="card"><h3 className="card-title mb-4">GSTR-1 Sales Summary</h3><div className="report-line"><span>Taxable sales</span><strong>₹4,11,017</strong></div><div className="report-line"><span>Output GST collected</span><strong>₹73,983</strong></div><div className="report-line"><span>B2B invoices</span><strong>18</strong></div></div><div className="card"><h3 className="card-title mb-4">GSTR-3B Liability</h3><div className="report-line"><span>Output GST</span><strong>₹73,983</strong></div><div className="report-line"><span>Input tax credit</span><strong className="text-success">- ₹43,200</strong></div><div className="report-total"><div><strong>Net GST payable</strong></div><strong>₹30,783</strong></div></div></div>}
  </div>;
}
