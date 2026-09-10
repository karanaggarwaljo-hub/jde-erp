'use client';

import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Download, Printer, TrendingUp, TrendingDown, ShoppingBag, Wallet, Receipt, IndianRupee, AlertCircle, PackageCheck, Percent } from 'lucide-react';
import { printCurrentPage } from '@/lib/client-export';
import { useCompanyTable } from '@/lib/useCompanyTable';
import AIReportSummary from '@/components/AIReportSummary';
import { AGE_BUCKETS, agingFrom, type AgeBucket } from '@/lib/aging';
import { invoiceBalanceDue } from '@/lib/invoice-balance';
import { stockValueLookup, type StockLayerLike } from '@/lib/stock-value';
import { costOfSales, grossProfit, gstPosition, type GstPosition, type PeriodConsumption, type PeriodInvoiceItem } from '@/lib/period-accounts';

type ReportType = 'pnl' | 'sales' | 'stock' | 'gst' | 'aging';

type Invoice = { id: string; customer: string; date: string; total: number; paid: number; status: string; settlement_write_off: number; gst_amount: number | null; };
type PurchaseOrder = { id: string; supplier: string; date: string; total: number; paid: number; status: string; gst_amount: number | null };
type Expense = { amount: number };
type Product = { id: string; category: string; current_stock: number; cost_price: number; sale_price: number };

const BUCKET_COLORS: Record<AgeBucket, string> = { '0-30': 'var(--color-success)', '31-60': 'var(--chart-amber)', '61-90': 'var(--chart-orange)', '90+': 'var(--color-danger)' };
const BUCKET_BG: Record<AgeBucket, string> = { '0-30': 'var(--color-success-bg)', '31-60': 'var(--amber-tint)', '61-90': 'color-mix(in srgb, var(--chart-orange) 12%, var(--surface))', '90+': 'var(--color-danger-bg)' };
const CATEGORY_COLORS = ['var(--chart-amber)', 'var(--chart-blue)', 'var(--color-success)', 'var(--chart-violet)', 'var(--chart-pink)', 'var(--chart-teal)'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-04-01" -> "1 Apr 2026". Parsed by hand rather than via toLocaleDateString so the string
 *  is identical on the server and in the browser (no locale/timezone hydration mismatch). */
function formatDay(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day || month > 12) return iso;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** Indian financial year (April–March) containing an ISO date: "2026-08-19" -> "2026-27". */
function financialYear(iso: string) {
  const [year, month] = iso.split('-').map(Number);
  if (!year || !month) return null;
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

/** Inclusive day count between two ISO dates, fixed to UTC so it can't drift by a day. */
function daysBetween(startIso: string, endIso: string) {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.floor((end - start) / 86400000) + 1;
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

/** GST panel. Every figure comes from what the documents themselves record — see
 *  lib/period-accounts.ts. It used to divide invoice and purchase totals by 1.18 and present the
 *  difference as tax collected, whatever the invoices actually said, which on real records meant
 *  reporting thousands of rupees of output tax that had never been charged to anybody.
 *
 *  The CGST/SGST rows are the payable split in half, which only holds for supply within the state.
 *  Place of supply is not recorded anywhere in the app, so that is stated as an assumption. */
function GstLiabilityPanel({ title, subtitle, position }: { title: string; subtitle: string; position: GstPosition }) {
  const { outputTax, inputTax, netPayable, anyTaxRecorded, invoiceCount, invoicesWithTax, purchaseCount, purchasesWithTax } = position;
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3 className="card-title">{title}</h3>
          <p className="text-muted text-sm">{subtitle}</p>
        </div>
      </div>

      {!anyTaxRecorded ? (
        <div className="empty-state">
          <p className="empty-state-title">No GST recorded on any document</p>
          <p className="empty-state-desc">
            None of the {invoiceCount} invoice{invoiceCount === 1 ? '' : 's'} or {purchaseCount} purchase
            order{purchaseCount === 1 ? '' : 's'} on file carries a GST amount, so there is nothing to
            summarise here. Set a GST rate when billing a sale or recording a purchase and this fills in
            from those documents.
          </p>
        </div>
      ) : (
        <>
          <div className="report-line">
            <span className="flex flex-col"><span>Output GST charged</span><small className="text-muted">Recorded on {invoicesWithTax} of {invoiceCount} invoice{invoiceCount === 1 ? '' : 's'}</small></span>
            <strong>₹{outputTax.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
          </div>
          <div className="report-line">
            <span className="flex flex-col"><span>Less: input tax credit</span><small className="text-muted">Recorded on {purchasesWithTax} of {purchaseCount} purchase order{purchaseCount === 1 ? '' : 's'}</small></span>
            <strong className="text-success">- ₹{inputTax.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
          </div>
          <div className="report-total mt-4">
            <div><strong>Net GST payable</strong><small>Output GST less input tax credit</small></div>
            <strong>₹{netPayable.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
          </div>
          <div className="mt-4">
            <div className="report-line"><span className="text-muted">CGST</span><span className="font-semibold">₹{(netPayable / 2).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
            <div className="report-line"><span className="text-muted">SGST</span><span className="font-semibold">₹{(netPayable / 2).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
            <p className="text-muted text-sm mt-2">
              Split evenly as CGST and SGST for supply within the state; place of supply is not recorded, so an
              inter-state sale would belong under IGST instead.
              {(invoicesWithTax < invoiceCount || purchasesWithTax < purchaseCount) && ' Documents with no GST recorded contribute nothing above.'}
              {' '}Credit notes for returned goods are not adjusted here. Treat this as indicative, not as a filed return.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>('pnl');
  const [feedback, setFeedback] = useState('');

  const { rows: invoices, activeCompany, error: invoicesError } = useCompanyTable<Invoice>('invoices');
  const { rows: purchaseOrders, error: purchaseOrdersError } = useCompanyTable<PurchaseOrder>('purchase_orders');
  const { rows: expenses, error: expensesError } = useCompanyTable<Expense>('expenses');
  const { rows: products, error: productsError } = useCompanyTable<Product>('products');
  const { rows: stockLayers, error: stockLayersError } = useCompanyTable<StockLayerLike>('stock_layers');
  // What each sale actually cost is recorded line by line against the batches it drew on. Without
  // these two the screen can only guess at cost, which is what it used to do.
  const { rows: invoiceItems, error: invoiceItemsError } = useCompanyTable<PeriodInvoiceItem>('invoice_items');
  const { rows: consumptions, error: consumptionsError } = useCompanyTable<PeriodConsumption>('stock_consumptions');

  // Every report here is summed from those five tables. A failed read would simply produce smaller
  // totals, which is indistinguishable from a quiet month — and these are the figures most likely
  // to be read as fact, printed, or handed to an accountant.
  const dataError = invoicesError ?? purchaseOrdersError ?? expensesError ?? productsError ?? stockLayersError
    ?? invoiceItemsError ?? consumptionsError;

  const totalRevenue = invoices.reduce((t, i) => t + Number(i.total || 0), 0);
  const totalPurchaseSpend = purchaseOrders.reduce((t, p) => t + Number(p.total || 0), 0);
  const totalExpenses = expenses.reduce((t, e) => t + Number(e.amount || 0), 0);
  // Sales less what those sales cost, from the batches the goods actually came out of. This used
  // to be sales less everything bought in the same window, which made buying stock look like a
  // loss and selling old stock look like pure profit. See lib/period-accounts.ts.
  const cost = costOfSales(invoices, invoiceItems, consumptions);
  const profit = grossProfit(invoices, cost);
  // Null when any line has no recorded cost: no figure at all beats a flattering one.
  const grossMargin = profit?.grossProfit ?? null;
  const netResult = grossMargin === null ? null : grossMargin - totalExpenses;

  const salesRows = [...invoices].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);
  const avgOrderValue = invoices.length > 0 ? totalRevenue / invoices.length : 0;
  const salesOutstandingDue = invoices.reduce((t, i) => t + invoiceBalanceDue(i), 0);

  // Valued by the one shared rule, each batch at what that batch cost (lib/stock-value.ts). This
  // screen used to multiply by the cost_price field while Inventory and the Dashboard used the
  // batches, so the same stock was reported here as ₹31,53,256 and there as ₹31,08,287.
  const stockValueFor = stockValueLookup(stockLayers);
  const stockByCategory = new Map<string, { count: number; qty: number; cost: number; retail: number }>();
  for (const p of products) {
    const entry = stockByCategory.get(p.category) ?? { count: 0, qty: 0, cost: 0, retail: 0 };
    entry.count += 1;
    entry.qty += Number(p.current_stock || 0);
    entry.cost += stockValueFor(p);
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

  // Only what the invoices and purchase orders themselves record. This used to divide every total
  // by 1.18 and call the difference tax collected, whichever rate the documents actually carried —
  // and on this company's records, not one of them carries any GST at all.
  const gst = gstPosition(invoices, purchaseOrders);

  const today = new Date();
  const receivablesAging = agingFrom(
    invoices.map((inv) => ({ key: inv.customer, date: inv.date, due: invoiceBalanceDue(inv) })),
    today
  );
  const payablesAging = agingFrom(
    purchaseOrders.filter((po) => po.status === 'received').map((po) => ({ key: po.supplier, date: po.date, due: Number(po.total) - Number(po.paid) })),
    today
  );
  const totalReceivablesDue = AGE_BUCKETS.reduce((t, b) => t + receivablesAging.totals[b], 0);
  const totalPayablesDue = AGE_BUCKETS.reduce((t, b) => t + payablesAging.totals[b], 0);

  // The period this page covers is not a setting — it is simply the span of the dated records
  // that are loaded. Anything that can't be read off those records is left off the screen.
  const datedRecords = [...invoices, ...purchaseOrders].map((row) => row.date).filter((date) => typeof date === 'string' && ISO_DATE.test(date)).sort();
  const periodStart = datedRecords[0] ?? null;
  const periodEnd = datedRecords[datedRecords.length - 1] ?? null;
  const periodRange = periodStart && periodEnd ? `${formatDay(periodStart)} – ${formatDay(periodEnd)}` : null;
  const fyStart = periodStart ? financialYear(periodStart) : null;
  const fyEnd = periodEnd ? financialYear(periodEnd) : null;
  const fyLabel = fyStart && fyEnd ? (fyStart === fyEnd ? fyStart : `${fyStart} to ${fyEnd}`) : null;
  const periodDays = periodStart && periodEnd ? daysBetween(periodStart, periodEnd) : null;
  const periodLine = periodRange
    ? [`Records on file: ${periodRange}`, fyLabel ? `FY ${fyLabel}` : null, periodDays ? `${periodDays} day${periodDays === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')
    : 'No dated sales or purchase records on file yet';
  const statementScope = [activeCompany?.name, periodRange ?? 'all records on file'].filter(Boolean).join(' · ');

  /** Share of total sales revenue. Left as an em dash when there is no revenue to divide by. */
  const pctOfRevenue = (value: number) => (totalRevenue > 0 ? `${((value / totalRevenue) * 100).toFixed(1)}%` : '—');

  const summaryData: Record<ReportType, unknown> = {
    // The AI is handed exactly what is on screen, including what is NOT known. It used to be told a
    // gross margin derived from purchases and described it back as healthy trading.
    pnl: {
      total_revenue: totalRevenue, total_purchase_spend: totalPurchaseSpend, total_expenses: totalExpenses,
      cost_of_goods_sold: cost.complete ? cost.cost : null,
      gross_profit: grossMargin, net_result: netResult,
      cost_is_incomplete: !cost.complete,
      lines_without_recorded_cost: cost.linesWithoutCost,
    },
    sales: { invoice_count: invoices.length, recent_invoices: salesRows.slice(0, 10).map((r) => ({ id: r.id, customer: r.customer, date: r.date, total: r.total, status: r.status })) },
    stock: { total_stock_units: totalStockUnits, by_category: stockRows.map(([category, row]) => ({ category, ...row })) },
    gst: {
      output_gst: gst.outputTax, input_tax_credit: gst.inputTax, net_gst_payable: gst.netPayable,
      invoices_recording_tax: gst.invoicesWithTax, invoice_count: gst.invoiceCount,
      purchases_recording_tax: gst.purchasesWithTax, purchase_count: gst.purchaseCount,
      no_tax_recorded_anywhere: !gst.anyTaxRecorded,
    },
    aging: { total_receivables_due: totalReceivablesDue, total_payables_due: totalPayablesDue, receivables_by_bucket: receivablesAging.totals, payables_by_bucket: payablesAging.totals },
  };

  return <div>
    <div className="page-header">
      <div>
        <div className="eyebrow">Financial reporting</div>
        <h1 className="page-title">Reports</h1>
        <p className="page-subtitle">{periodLine}</p>
      </div>
      <div className="flex gap-2"><button className="btn btn-secondary" onClick={printCurrentPage}><Printer size={16} /> Print Report</button><a className="btn btn-primary" href={`/api/export?type=${reportType}`} download onClick={() => setFeedback('Report export started.')}><Download size={16} /> Export CSV</a></div>
    </div>
    {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}
    {dataError && (
      <div className="alert alert-danger mb-4" role="alert">
        Some of this company&apos;s records could not be loaded, so every figure below is of only
        part of the data. Reload before relying on, printing or exporting any of it — {dataError}
      </div>
    )}

    <div className="flex items-center justify-between gap-4 mb-6" style={{ flexWrap: 'wrap' }}>
      <div className="tabs report-tabs"><button className={`tab ${reportType === 'pnl' ? 'active' : ''}`} onClick={() => setReportType('pnl')}>Profit & Loss</button><button className={`tab ${reportType === 'sales' ? 'active' : ''}`} onClick={() => setReportType('sales')}>Sales Summary</button><button className={`tab ${reportType === 'stock' ? 'active' : ''}`} onClick={() => setReportType('stock')}>Stock Valuation</button><button className={`tab ${reportType === 'gst' ? 'active' : ''}`} onClick={() => setReportType('gst')}>GST Summary</button><button className={`tab ${reportType === 'aging' ? 'active' : ''}`} onClick={() => setReportType('aging')}>Aging</button></div>
      <span className="text-muted text-sm">All figures in ₹, as billed — invoice and purchase totals as entered, not cash received</span>
    </div>

    <AIReportSummary reportType={reportType} data={summaryData[reportType]} />

    {reportType === 'pnl' && <>
      {receivablesAging.totals['90+'] > 0 && <div className="alert alert-warning mb-4">
        <AlertCircle size={16} />
        <span>₹{receivablesAging.totals['90+'].toLocaleString()} of this revenue was invoiced more than 90 days ago and is still unpaid.</span>
        <button type="button" className="alert-action" onClick={() => setReportType('aging')}>Open aging report</button>
      </div>}
      <div className="kpi-grid">
        <Kpi title="Total Revenue" value={`₹${totalRevenue.toLocaleString()}`} icon={TrendingUp} color="var(--color-success)" bg="var(--color-success-bg)" />
        <Kpi title="Cost of goods sold" value={cost.complete ? `₹${cost.cost.toLocaleString()}` : 'Not known'} icon={ShoppingBag} color="var(--chart-blue)" bg="var(--color-info-bg)" />
        <Kpi title="Gross Profit" value={grossMargin === null ? 'Not known' : `₹${grossMargin.toLocaleString()}`} icon={Wallet} color="var(--chart-amber)" bg="var(--amber-tint)" />
        <Kpi title="Net Result" value={netResult === null ? 'Not known' : `₹${netResult.toLocaleString()}`} icon={(netResult ?? 0) >= 0 ? TrendingUp : TrendingDown} color={(netResult ?? 0) >= 0 ? 'var(--color-success)' : 'var(--color-danger)'} bg={(netResult ?? 0) >= 0 ? 'var(--color-success-bg)' : 'var(--color-danger-bg)'} />
      </div>

      <div className="dashboard-split">
        <div className="table-wrap">
          <div className="tbl-toolbar">
            <div className="tbl-toolbar-title">
              <strong>Profit &amp; loss statement</strong>
              <small>{statementScope}</small>
            </div>
            <div className="tbl-tools">
              <span className="badge badge-muted">Provisional · unaudited</span>
              {netResult !== null && <span className={`badge ${netResult >= 0 ? 'badge-success' : 'badge-danger'}`}>{netResult >= 0 ? 'Profitable' : 'Loss'}</span>}
            </div>
          </div>
          <table className="erp-table">
            <thead><tr><th>Particulars</th><th className="text-right">This period ₹</th><th className="text-right">% of revenue</th></tr></thead>
            <tbody>
              <tr><th colSpan={3} scope="colgroup">Revenue</th></tr>
              <tr>
                <td><span className="flex flex-col"><span>Total sales revenue</span><small className="text-muted">{invoices.length} invoice{invoices.length === 1 ? '' : 's'} on file</small></span></td>
                <td className="text-right font-semibold text-success">₹{totalRevenue.toLocaleString()}</td>
                <td className="text-right text-muted">{pctOfRevenue(totalRevenue)}</td>
              </tr>

              <tr><th colSpan={3} scope="colgroup">Less: cost of goods sold</th></tr>
              <tr>
                <td><span className="flex flex-col"><span>Cost of goods sold</span><small className="text-muted">What the goods on those invoices cost, from the batches they came out of</small></span></td>
                <td className="text-right">{cost.complete ? `- ₹${cost.cost.toLocaleString()}` : 'Not known'}</td>
                <td className="text-right text-muted">{cost.complete ? pctOfRevenue(cost.cost) : '—'}</td>
              </tr>
              <tr>
                <td className="font-semibold">Gross profit</td>
                <td className="text-right font-semibold text-brand">{grossMargin === null ? 'Not known' : `₹${grossMargin.toLocaleString()}`}</td>
                <td className="text-right font-semibold">{grossMargin === null ? '—' : pctOfRevenue(grossMargin)}</td>
              </tr>

              <tr><th colSpan={3} scope="colgroup">Less: operating expenses</th></tr>
              <tr>
                <td><span className="flex flex-col"><span>Operating expenses</span><small className="text-muted">{expenses.length} expense entr{expenses.length === 1 ? 'y' : 'ies'} on file</small></span></td>
                <td className="text-right">- ₹{totalExpenses.toLocaleString()}</td>
                <td className="text-right text-muted">{pctOfRevenue(totalExpenses)}</td>
              </tr>
              <tr>
                <td><span className="flex flex-col"><strong>Net result</strong><small className="text-muted">After the cost of goods sold and operating expenses</small></span></td>
                <td className="text-right">{netResult === null ? <span className="text-muted">Not known</span> : <strong className={netResult >= 0 ? 'text-success' : 'text-danger'} style={{ fontSize: '16px' }}>₹{netResult.toLocaleString()}</strong>}</td>
                <td className="text-right font-semibold">{netResult === null ? '—' : pctOfRevenue(netResult)}</td>
              </tr>
            </tbody>
          </table>
          <div className="pager">
            <span className="pager-info">{cost.complete
              ? 'Cost of goods sold is the real cost of the stock that left the shelf, batch by batch — not the amount spent on purchases in the same period.'
              : `${cost.linesWithoutCost} line${cost.linesWithoutCost === 1 ? '' : 's'} across ${cost.invoicesAffected} invoice${cost.invoicesAffected === 1 ? '' : 's'} ${cost.linesWithoutCost === 1 ? 'has' : 'have'} no recorded cost, so profit cannot be worked out. Purchases in this period came to ₹${totalPurchaseSpend.toLocaleString()}, which is a different figure and not a substitute for it.`}</span>
            <span className="pager-info">Percentages are of total sales revenue.</span>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <GstLiabilityPanel
            title="GST summary"
            subtitle="From the GST recorded on the invoices and purchase orders themselves"
            position={gst}
          />
          <div className="card">
            <div className="card-header"><h3 className="card-title">Revenue vs. Costs</h3></div>
            <ValueBars rows={[
              { label: 'Total Revenue', value: totalRevenue, color: 'var(--color-success)' },
              ...(cost.complete ? [{ label: 'Cost of goods sold', value: cost.cost, color: 'var(--chart-blue)' }] : []),
              { label: 'Operating Expenses', value: totalExpenses, color: 'var(--chart-orange)' },
              ...(netResult === null ? [] : [{ label: 'Net Result', value: netResult, color: netResult >= 0 ? 'var(--chart-amber)' : 'var(--color-danger)' }]),
            ]} />
          </div>
        </div>
      </div>
    </>}

    {reportType === 'sales' && <>
      <div className="kpi-grid">
        <Kpi title="Total Invoices" value={`${invoices.length}`} icon={Receipt} color="var(--chart-blue)" bg="var(--color-info-bg)" />
        <Kpi title="Total Revenue" value={`₹${totalRevenue.toLocaleString()}`} icon={TrendingUp} color="var(--color-success)" bg="var(--color-success-bg)" />
        <Kpi title="Avg Order Value" value={`₹${avgOrderValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} icon={IndianRupee} color="var(--chart-amber)" bg="var(--amber-tint)" />
        <Kpi title="Outstanding Due" value={`₹${salesOutstandingDue.toLocaleString()}`} icon={AlertCircle} color="var(--color-danger)" bg="var(--color-danger-bg)" />
      </div>
      <div className="table-wrap">
        <div className="tbl-toolbar">
          <div className="tbl-toolbar-title"><strong>Recent invoices</strong><small>Newest first{periodRange ? ` · records on file cover ${periodRange}` : ''}</small></div>
          <div className="tbl-tools"><span className="badge badge-info">{salesRows.length} shown</span></div>
        </div>
        <table className="erp-table"><thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th className="text-right">Amount</th><th>Status</th></tr></thead><tbody>{salesRows.map((row) => <tr key={row.id}><td><span className="pn-chip">{row.id}</span></td><td>{row.customer}</td><td className="text-muted">{row.date}</td><td className="text-right font-semibold">₹{Number(row.total).toLocaleString()}</td><td><span className={`badge ${row.status === 'paid' ? 'badge-success' : row.status === 'partial' ? 'badge-warning' : 'badge-danger'}`}>{row.status.toUpperCase()}</span></td></tr>)}
          {salesRows.length === 0 && <tr><td colSpan={5}><div className="empty-state"><p className="empty-state-title">No invoices yet</p><p className="empty-state-desc">This company has no sales on file.</p></div></td></tr>}
        </tbody></table>
        {invoices.length > 0 && <div className="pager"><span className="pager-info">Showing <strong>{salesRows.length}</strong> of <strong>{invoices.length}</strong> invoices</span></div>}
      </div>
    </>}

    {reportType === 'stock' && <>
      <div className="kpi-grid">
        <Kpi title="Total Stock Units" value={`${totalStockUnits}`} icon={PackageCheck} color="var(--chart-blue)" bg="var(--color-info-bg)" />
        <Kpi title="Total Cost Value" value={`₹${totalCostValue.toLocaleString()}`} icon={Wallet} color="var(--chart-amber)" bg="var(--amber-tint)" />
        <Kpi title="Total Retail Value" value={`₹${totalRetailValue.toLocaleString()}`} icon={TrendingUp} color="var(--color-success)" bg="var(--color-success-bg)" />
        <Kpi title="Expected Margin" value={`₹${(totalRetailValue - totalCostValue).toLocaleString()}`} icon={Percent} color="var(--chart-violet)" bg="color-mix(in srgb, var(--chart-violet) 12%, var(--surface))" />
      </div>
      <div className="dashboard-split">
        <div className="table-wrap">
          <div className="tbl-toolbar">
            <div className="tbl-toolbar-title"><strong>Warehouse inventory valuation</strong><small>Stock on hand right now, valued at cost and at sale price</small></div>
            <div className="tbl-tools"><span className="badge badge-info">{totalStockUnits} total units</span></div>
          </div>
          <table className="erp-table">
            <thead><tr><th>Category</th><th>Items</th><th>Qty</th><th className="text-right">Cost</th><th className="text-right">Retail</th></tr></thead>
            <tbody>{stockRows.map(([category, row]) => <tr key={category}><td>{category}</td><td>{row.count}</td><td>{row.qty}</td><td className="text-right">₹{row.cost.toLocaleString()}</td><td className="text-right">₹{row.retail.toLocaleString()}</td></tr>)}
              {stockRows.length === 0 && <tr><td colSpan={5}><div className="empty-state"><p className="empty-state-title">No inventory yet</p><p className="empty-state-desc">This company has no parts on file.</p></div></td></tr>}
            </tbody>
            {stockRows.length > 0 && <tfoot><tr>
              <td className="font-semibold">All categories</td>
              <td className="font-semibold">{products.length}</td>
              <td className="font-semibold">{totalStockUnits}</td>
              <td className="text-right font-semibold">₹{totalCostValue.toLocaleString()}</td>
              <td className="text-right font-semibold">₹{totalRetailValue.toLocaleString()}</td>
            </tr></tfoot>}
          </table>
          <div className="pager"><span className="pager-info">Valuation is a snapshot of current stock — it is not tied to the reporting period above.</span></div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="card-title">Category Value Mix</h3><span className="badge badge-info">At Cost</span></div>
          <div className="category-bars">
            {stockCategoryMix.length === 0 && <p className="text-muted text-sm">No inventory yet for this company.</p>}
            {stockCategoryMix.map((category) => <div key={category.category}><div className="flex justify-between mb-1"><strong>{category.category}</strong><span>₹{category.amount.toLocaleString()} ({category.share}%)</span></div><div className="progress-track"><div style={{ width: `${category.share}%`, background: category.color }} /></div></div>)}
          </div>
        </div>
      </div>
    </>}

    {reportType === 'gst' && <>
      <div className="kpi-grid">
        <Kpi title="Sales invoiced" value={`₹${totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} icon={Receipt} color="var(--chart-blue)" bg="var(--color-info-bg)" />
        <Kpi title="Output GST charged" value={gst.anyTaxRecorded ? `₹${gst.outputTax.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'None recorded'} icon={TrendingUp} color="var(--chart-orange)" bg="color-mix(in srgb, var(--chart-orange) 12%, var(--surface))" />
        <Kpi title="Input Tax Credit" value={gst.anyTaxRecorded ? `₹${gst.inputTax.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'None recorded'} icon={TrendingDown} color="var(--color-success)" bg="var(--color-success-bg)" />
        <Kpi title="Net GST Payable" value={gst.anyTaxRecorded ? `₹${gst.netPayable.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'None recorded'} icon={IndianRupee} color="var(--color-danger)" bg="var(--color-danger-bg)" />
      </div>
      <div className="dashboard-split">
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">GSTR-1 Sales Summary</h3>
              <p className="text-muted text-sm">From the GST recorded on the invoices themselves</p>
            </div>
            {periodRange && <span className="badge badge-muted">{periodRange}</span>}
          </div>
          <div className="report-line"><span>Sales invoiced</span><strong>₹{totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div>
          <div className="report-line"><span>Output GST charged</span><strong>{gst.anyTaxRecorded ? `₹${gst.outputTax.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'None recorded'}</strong></div>
          <div className="report-line"><span>Invoices</span><strong>{gst.invoiceCount}</strong></div>
          <div className="report-line"><span>Invoices carrying GST</span><strong>{gst.invoicesWithTax}</strong></div>
        </div>
        <GstLiabilityPanel
          title="GSTR-3B Liability"
          subtitle="From the GST recorded on the invoices and purchase orders themselves"
          position={gst}
        />
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
