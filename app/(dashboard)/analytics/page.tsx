'use client';

import AIInsightsCard from '@/components/AIInsightsCard';
import AIForecastCard from '@/components/AIForecastCard';
import { useCompanyTable } from '@/lib/useCompanyTable';

type Product = { id: string; part_number: string; name: string; brand: string; category: string; current_stock: number; cost_price: number };

const CATEGORY_COLORS = ['#F59E0B', '#3B82F6', '#10B981', '#8B5CF6', '#EC4899', '#06B6D4'];

export default function AnalyticsPage() {
  const { rows: products } = useCompanyTable<Product>('products');

  const topByStockValue = [...products]
    .map((p) => ({ ...p, value: Number(p.current_stock || 0) * Number(p.cost_price || 0) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const categoryTotals = new Map<string, number>();
  for (const p of products) {
    categoryTotals.set(p.category, (categoryTotals.get(p.category) ?? 0) + Number(p.current_stock || 0) * Number(p.cost_price || 0));
  }
  const totalValue = Array.from(categoryTotals.values()).reduce((t, v) => t + v, 0);
  const categoryMix = Array.from(categoryTotals.entries())
    .map(([category, amount], index) => ({ category, amount, share: totalValue > 0 ? Math.round((amount / totalValue) * 100) : 0, color: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }))
    .sort((a, b) => b.amount - a.amount);

  return <div>
    <div className="page-header"><div><h1 className="page-title">Analytics & AI Demand Forecasting</h1><p className="page-subtitle">Predictive stock replenishment, inventory value and spare part mix analytics</p></div></div>

    <AIForecastCard />

    <AIInsightsCard />

    <div className="grid-2 mb-6">
      <div className="card">
        <div className="card-header"><h3 className="card-title">Top 5 Parts by Stock Value</h3><span className="badge badge-success">At Cost</span></div>
        <div className="ranked-list">
          {topByStockValue.length === 0 && <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No inventory yet for this company.</p>}
          {topByStockValue.map((product, index) => <div key={product.id} className="ranked-row"><span className="rank-number">#{index + 1}</span><div className="ranked-copy"><strong>{product.name}</strong><small>{product.part_number} • {product.brand}</small></div><div className="ranked-value"><strong>₹{product.value.toLocaleString()}</strong><small>{product.current_stock} units in stock</small></div></div>)}
        </div>
      </div>
      <div className="card">
        <div className="card-header"><h3 className="card-title">Category Stock Value Mix</h3><span className="badge badge-info">At Cost</span></div>
        <div className="category-bars">
          {categoryMix.length === 0 && <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No inventory yet for this company.</p>}
          {categoryMix.map((category) => <div key={category.category}><div className="flex justify-between mb-1"><strong>{category.category}</strong><span>₹{category.amount.toLocaleString()} ({category.share}%)</span></div><div className="progress-track"><div style={{ width: `${category.share}%`, background: category.color }} /></div></div>)}
        </div>
      </div>
    </div>
  </div>;
}
