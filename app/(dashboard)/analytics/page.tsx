'use client';

import AIInsightsCard from '@/components/AIInsightsCard';
import AIForecastCard from '@/components/AIForecastCard';

const topProducts = [
  { code: 'SP-001', name: 'Brake Pad Set - Front', brand: 'Bosch', sold: 142, revenue: '₹1,56,200' },
  { code: 'SP-003', name: 'Oil Filter', brand: 'Mann', sold: 210, revenue: '₹63,000' },
  { code: 'SP-002', name: 'Air Filter - Premium', brand: 'Denso', sold: 98, revenue: '₹56,840' },
  { code: 'SP-005', name: 'Spark Plug Set (4pcs)', brand: 'NGK', sold: 64, revenue: '₹62,720' },
  { code: 'SP-004', name: 'Clutch Plate', brand: 'LUK', sold: 18, revenue: '₹75,600' },
];

export default function AnalyticsPage() {
  return <div>
    <div className="page-header"><div><h1 className="page-title">Analytics & AI Demand Forecasting</h1><p className="page-subtitle">Predictive stock replenishment, sales trends and spare part velocity analytics</p></div></div>

    <AIForecastCard />

    <AIInsightsCard />

    <div className="grid-2 mb-6"><div className="card"><div className="card-header"><h3 className="card-title">Top 5 Best Selling Spare Parts</h3><span className="badge badge-success">By Volume</span></div><div className="ranked-list">{topProducts.map((product, index) => <div key={product.code} className="ranked-row"><span className="rank-number">#{index + 1}</span><div className="ranked-copy"><strong>{product.name}</strong><small>{product.code} • {product.brand}</small></div><div className="ranked-value"><strong>{product.revenue}</strong><small>{product.sold} units sold</small></div></div>)}</div></div>
      <div className="card"><div className="card-header"><h3 className="card-title">Category Revenue Mix</h3><span className="badge badge-info">July 2026</span></div><div className="category-bars">{[
        { category: 'Brakes & Friction', share: 38, amount: '₹1,84,300', color: '#F59E0B' }, { category: 'Engine Parts', share: 26, amount: '₹1,26,100', color: '#3B82F6' }, { category: 'Filters & Fluids', share: 20, amount: '₹97,000', color: '#10B981' }, { category: 'Clutch & Transmission', share: 16, amount: '₹77,600', color: '#8B5CF6' },
      ].map((category) => <div key={category.category}><div className="flex justify-between mb-1"><strong>{category.category}</strong><span>{category.amount} ({category.share}%)</span></div><div className="progress-track"><div style={{ width: `${category.share}%`, background: category.color }} /></div></div>)}</div></div></div>
  </div>;
}
