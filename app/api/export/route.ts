const exports: Record<string, { filename: string; rows: Array<Array<string | number>> }> = {
  dashboard: {
    filename: 'jde-dashboard-summary.csv',
    rows: [
      ['Metric', 'Value', 'Status', 'Context'],
      ["Today's Sales", '₹1,24,500', '+14.2%', 'vs yesterday'],
      ["Today's Purchases", '₹48,200', '-5.1%', 'vs yesterday'],
      ['Gross Profit', '₹36,800', '+18.5%', 'vs yesterday'],
      ['Cash Balance', '₹3,45,000', '+2.4%', 'vs last business day'],
      ['Inventory Value', '₹18,50,000', '840 items', 'across all locations'],
      ['Total Receivables', '₹2,15,400', '4 overdue', 'follow up today'],
      ['Total Payables', '₹1,32,000', '2 due today', 'before close of business'],
      ['Low Stock Items', '12 parts', 'Action required', '3 critical shortages'],
    ],
  },
  pnl: { filename: 'jde-profit-and-loss.csv', rows: [['Line Item', 'Amount'], ['Total Sales Revenue', 485000], ['Cost of Goods Sold', -290000], ['Gross Profit', 195000], ['Operating Expenses', -83050], ['Net Operating Profit', 111950]] },
  sales: { filename: 'jde-sales-summary.csv', rows: [['Invoice', 'Customer', 'Date', 'Amount', 'Status'], ['INV-1042', 'Sharma Auto Works', '2026-07-23', 18400, 'Paid'], ['INV-1041', 'City Motors Garage', '2026-07-22', 42500, 'Partial'], ['INV-1040', 'Kumar Spare Parts', '2026-07-21', 8200, 'Unpaid']] },
  stock: { filename: 'jde-stock-valuation.csv', rows: [['Category', 'Product Count', 'Stock Quantity', 'Cost Value', 'Retail Value', 'Expected Margin'], ['Brakes', '12 Items', '145 Pcs', 245000, 380000, 135000], ['Filters', '24 Items', '380 Pcs', 180000, 320000, 140000], ['Engine & Clutch', '18 Items', '95 Pcs', 650000, 920000, 270000]] },
  gst: { filename: 'jde-gst-summary.csv', rows: [['Metric', 'Amount'], ['Taxable sales', 411017], ['Output GST', 73983], ['Input tax credit', 43200], ['Net GST payable', 30783]] },
};

export async function GET(request: Request) {
  const type = new URL(request.url).searchParams.get('type') ?? 'pnl';
  const report = exports[type] ?? exports.pnl;
  const csv = report.rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
  return new Response(`\uFEFF${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${report.filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
