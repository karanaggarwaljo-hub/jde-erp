'use client';

import { FormEvent, useMemo, useState } from 'react';
import {
  Plus,
  Printer,
  Search,
  Eye,
  Pencil,
  Trash2,
  ArrowRight,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  IndianRupee,
  Receipt,
  TrendingUp,
  Package,
  AlertTriangle,
  CheckCircle2,
  X,
  XCircle,
  MapPin,
  Undo2,
  Wallet,
  HandCoins,
  History,
} from 'lucide-react';
import { saveSalesInvoice, deleteSalesInvoice, deleteCustomerPayment, writeOffInvoiceBalance, receiveCustomerPayment, getInvoiceCost } from '@/lib/client-sales';
import { realisedProfit, type InvoiceCost } from '@/lib/invoice-profit';
import { invoiceBalanceDue, invoiceWrittenOff, wasSettledShort } from '@/lib/invoice-balance';
import { addCustomLine, addPartToLines, buildLastSoldIndex, partLabel } from '@/lib/sale-entry';
import { keepEnterInsideForm } from '@/lib/form-keys';
import { createSalesReturn, deleteSalesReturn, getReturnableInvoiceItems, type ReturnableInvoiceItem, type SalesReturnRow } from '@/lib/client-sales-returns';
import { duplicateCreditNotes } from '@/lib/sales-returns';
import { convertQuotation, getQuotation, saveQuotation, type QuotationDetail } from '@/lib/client-quotations';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { buildCustomerLedger } from '@/lib/customer-ledger';
import AddCustomerModal from '@/components/AddCustomerModal';
import PartPicker from '@/components/PartPicker';
import ReceivePaymentModal from '@/components/ReceivePaymentModal';
import { money, paise, round2 } from '@/lib/money';
import InvoiceFormModal from '@/components/sales/InvoiceFormModal';
import { amountReceived, billTotals, lineDiscountAmount, lineDiscountPercent, lineGross, lineNet } from '@/lib/invoice-totals';
import {
  DRAFT_STATUS,
  QUOTATION_FINAL_STATUS,
  GST_STATE_NAMES,
  WALK_IN_CUSTOMER,
  type Customer,
  type Invoice,
  type InvoiceItem,
  type Payment,
  type PaymentAllocation,
  type PaymentStatus,
  type InvoiceLine,
  type PartOption,
  type Product,
  type Quotation,
} from '@/lib/sales-types';

type SalesTab = 'invoices' | 'quotations' | 'credits' | 'ledger';
type PaymentFilter = 'all' | 'paid' | 'partial' | 'unpaid' | 'drafts';

// Everything the printable document needs, captured at the moment it is opened. A snapshot rather
// than a live lookup, so the document keeps showing the invoice it was opened for even after the
// dialog behind it has been reset for the next sale.
// The status the atomic save is given for a sale the owner wants to park and finish later. It
// reserves stock like any other invoice, but nothing is billed and nothing is owed yet.

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

// How many invoice rows are painted at once. Every invoice is already in memory — this changes
// nothing about what is loaded, only how much of it is rendered, so paging costs no extra request.
const PAGE_SIZE = 25;

// Reference data, not business data: the statutory GST state codes, which are the first two
// digits of every GSTIN. Used only to name the place of supply on a tax invoice — nothing here
// is a figure, a price or a company-specific value.

// Indian digit grouping, matching Inventory and Customers. Display only — nothing rounded here
// is ever written back.

// Which page buttons to show: short lists show every page, long ones collapse to 1 … n-1 n n+1 … last.
function pageWindow(current: number, total: number): Array<number | 'gap'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const wanted = [1, total, current - 1, current, current + 1]
    .filter((n) => n >= 1 && n <= total)
    .sort((a, b) => a - b);
  const shown: Array<number | 'gap'> = [];
  let previous = 0;
  for (const n of wanted) {
    if (n === previous) continue;
    if (previous && n - previous > 1) shown.push('gap');
    shown.push(n);
    previous = n;
  }
  return shown;
}

// Leaving the customer field blank means a walk-in sale — no account to bill, so it's stored
// under this fixed label rather than as an empty string. Kept separate from the `customer` form
// state (which stays '' for a walk-in) so the customer-lookup logic below never has to special-case
// it — an empty string simply never matches a real customer.

// A credit note stores only a UTC timestamp. The shop trades in IST, so it is shown in IST —
// one written at 8pm here is stored as the next day in UTC, and printing the raw date would put
// it on a day nobody was in the shop. Same shift the day book applies.
function formatDateTime(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp;
  return parsed.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function SalesPage() {
  const { rows: products, reload: reloadProducts, activeCompany } = useCompanyTable<Product>('products');
  const { rows: customers, create: createCustomer, reload: reloadCustomers } = useCompanyTable<Customer>('customers');
  const { rows: invoices, loading: invoicesLoading, reload: reloadInvoices } = useCompanyTable<Invoice>('invoices');
  const { rows: quotations, loading: quotationsLoading, reload: reloadQuotations } = useCompanyTable<Quotation>('quotations');
  const { rows: invoiceItems, reload: reloadInvoiceItems } = useCompanyTable<InvoiceItem>('invoice_items');
  const { rows: payments, reload: reloadPayments } = useCompanyTable<Payment>('payments_received');
  const { rows: paymentAllocations } = useCompanyTable<PaymentAllocation>('payment_allocations');
  // Only to grey out Edit and Delete on an invoice goods have already come back against.
  const { rows: salesReturns, reload: reloadSalesReturns } = useCompanyTable<SalesReturnRow>('sales_returns');

  // `value` is what a line stores and what the save path matches on, so it stays exactly the
  // label it has always been. The rest are fields off the same already-loaded product row, used to
  // search for the part and to describe the line once it is on the invoice.
  //
  // Numbers are coerced here rather than at each use: Postgres numeric columns arrive as strings
  // over the REST API, and the search ranking and the stock/below-cost warnings compare them.
  const partOptions = useMemo(() => products.map((product) => ({
    value: partLabel(product.part_number, product.name),
    price: Number(product.sale_price) || 0,
    costPrice: Number(product.cost_price) || 0,
    category: product.category,
    partNumber: product.part_number,
    name: product.name,
    brand: product.brand,
    stock: Number(product.current_stock) || 0,
    hsn: product.hsn_code,
  })), [products]);

  const [activeTab, setActiveTab] = useState<SalesTab>('invoices');
  const [search, setSearch] = useState('');
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Invoice | null>(null);
  // Closing an invoice a customer settled by paying less than it was for.
  //
  // This used to be two jobs on two screens: record the cash on the payments modal, then come
  // back here and type the shortfall as a separate write-off. The owner had to do the subtraction
  // himself, and the only figure he was ever asked for was the one he was losing. It now takes the
  // money he was actually handed and works the rest out from there.
  const [settlingInvoice, setSettlingInvoice] = useState<Invoice | null>(null);
  const [settleReceived, setSettleReceived] = useState(0);
  const [settleReason, setSettleReason] = useState('');
  // What the goods on this invoice cost. Null while it loads, and still null if it cannot be
  // established — in which case no profit figure is shown at all rather than a flattering guess.
  const [settleCost, setSettleCost] = useState<InvoiceCost | null>(null);
  const [settleError, setSettleError] = useState('');
  const [savingSettlement, setSavingSettlement] = useState(false);
  const [returnCandidate, setReturnCandidate] = useState<Invoice | null>(null);
  const [returnableItems, setReturnableItems] = useState<ReturnableInvoiceItem[]>([]);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [returnReason, setReturnReason] = useState('');
  // What condition each returned line came back in. Absent means resellable, which is what the
  // great majority of returns are and what the database assumes when a caller says nothing.
  const [returnConditions, setReturnConditions] = useState<Record<string, 'resellable' | 'damaged'>>({});
  const [returnError, setReturnError] = useState('');
  const [loadingReturn, setLoadingReturn] = useState(false);
  const [savingReturn, setSavingReturn] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [invoiceError, setInvoiceError] = useState('');
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentModalCustomerId, setPaymentModalCustomerId] = useState<string | undefined>(undefined);
  const [ledgerCustomerId, setLedgerCustomerId] = useState('');
  const [deletePaymentCandidate, setDeletePaymentCandidate] = useState<Payment | null>(null);
  const [deletingPayment, setDeletingPayment] = useState(false);
  const [deletePaymentError, setDeletePaymentError] = useState('');

  const openReceivePayment = (customerId?: string) => {
    setPaymentModalCustomerId(customerId);
    setShowPaymentModal(true);
  };

  // Undoing a credit note. Kept beside the other delete confirmations rather than done inline:
  // it moves stock and can move a customer's balance, so it gets the same "are you sure" as
  // deleting an invoice does.
  const [creditToUndo, setCreditToUndo] = useState<SalesReturnRow | null>(null);
  const [undoingCredit, setUndoingCredit] = useState(false);
  const [creditError, setCreditError] = useState('');

  const [deleteError, setDeleteError] = useState('');
  const [deletingInvoice, setDeletingInvoice] = useState(false);
  const [customer, setCustomer] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [gstPercent, setGstPercent] = useState(18);
  // Whether the rates typed on the lines are before GST (tax added on top) or already include it
  // (tax carved out of them). Only ever changes how the same typed numbers are read.
  const [gstInclusive, setGstInclusive] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('unpaid');
  const [amountPaid, setAmountPaid] = useState(0);
  // Presentation-only view state: which payment slice of the list is on screen, and which page
  // of it. Neither touches what is loaded or what is saved.
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const [page, setPage] = useState(1);
  const [showQuotationModal, setShowQuotationModal] = useState(false);
  const [editingQuotation, setEditingQuotation] = useState<QuotationDetail | null>(null);
  const [viewingQuotation, setViewingQuotation] = useState<QuotationDetail | null>(null);
  const [quotationError, setQuotationError] = useState('');
  const [savingQuotation, setSavingQuotation] = useState(false);
  const [savingQuoteDraft, setSavingQuoteDraft] = useState(false);
  const [loadingQuotation, setLoadingQuotation] = useState(false);
  const [convertingQuotationId, setConvertingQuotationId] = useState<string | null>(null);
  const [quoteCustomer, setQuoteCustomer] = useState('');
  const [quoteDate, setQuoteDate] = useState(todayIso());
  const [quoteValidity, setQuoteValidity] = useState(todayIso());
  const [quoteLines, setQuoteLines] = useState<InvoiceLine[]>([]);
  const [quoteDiscountPercent, setQuoteDiscountPercent] = useState(0);
  const [quoteGstPercent, setQuoteGstPercent] = useState(18);
  const [quoteGstInclusive, setQuoteGstInclusive] = useState(false);

  // Both bills are priced by the same tested arithmetic — see lib/invoice-totals.ts for why the
  // invoice used to disagree with the quotation, and how it showed up in the data.
  const invoiceMoney = billTotals({ lines, discountPercent, gstPercent, gstInclusive });
  // Only what the page itself still shows or sends; the rest of the figures live with the form.
  const { discountAmount, gstAmount, total } = invoiceMoney;
  const paidAmount = amountReceived(paymentStatus, total, amountPaid);

  const quoteMoney = billTotals({
    lines: quoteLines,
    discountPercent: quoteDiscountPercent,
    gstPercent: quoteGstPercent,
    gstInclusive: quoteGstInclusive,
  });
  const quoteSubtotal = quoteMoney.subtotal;
  const quoteItemDiscountTotal = quoteMoney.itemDiscountTotal;
  const quoteDiscountAmount = quoteMoney.discountAmount;
  const quoteGstAmount = quoteMoney.gstAmount;
  const quoteNetTaxableValue = quoteMoney.netTaxableValue;
  const quoteTotal = quoteMoney.total;
  // Same three helpers as the invoice lines use; kept under the quote names so the quotation
  // markup below reads as it always did.
  const quoteLineGross = lineGross;
  const quoteLineDiscount = lineDiscountAmount;
  const quoteLineNet = lineNet;

  // A quotation draft is a quote still being written: it is not ready to hand to the customer and
  // cannot be turned into an invoice, which is the only step that costs stock or puts money on an
  // account. The same idea as a parked sale, and the same word for it.
  const isQuoteDraft = (quote: Quotation) => quote.status === DRAFT_STATUS;
  const editingQuoteDraft = Boolean(editingQuotation && editingQuotation.status === DRAFT_STATUS);

  // What the Status column says, in the owner's words rather than the stored value. A draft is
  // never called EXPIRED: it was never given to anybody, so its validity date is still only a plan.
  const quoteBadge = (quote: Quotation): { className: string; label: string } => {
    if (quote.status === 'converted') return { className: 'badge-success', label: 'CONVERTED' };
    if (quote.status === 'accepted') return { className: 'badge-success', label: 'ACCEPTED' };
    if (isQuoteDraft(quote)) return { className: 'badge-muted', label: 'DRAFT' };
    if (quote.validity < todayIso()) return { className: 'badge-warning', label: 'EXPIRED' };
    return { className: 'badge-info', label: quote.status === QUOTATION_FINAL_STATUS ? 'FINAL' : quote.status.toUpperCase() };
  };

  const selectedCustomer = customers.find((c) => c.name === customer);

  // What this customer was actually charged for each part last time, which is the question being
  // asked whenever a rate is set at the counter. Built from invoices already loaded for the list,
  // so it costs no extra fetch, and empty for a walk-in sale — there is no account to look back on.
  const lastSold = useMemo(
    () => buildLastSoldIndex(customer, invoices, invoiceItems, DRAFT_STATUS),
    [customer, invoices, invoiceItems]
  );
  const customerLabel = customer.trim() || WALK_IN_CUSTOMER;
  // A parked draft opens in this dialog exactly like an edit, with one difference that matters for
  // money: parking it added nothing to the customer's balance, so confirming it has to start from
  // zero outstanding. Starting from its total would reverse a debt that was never recorded.
  const editingDraft = Boolean(editingInvoice && editingInvoice.status === DRAFT_STATUS);
  const editingOldOutstanding = editingInvoice && !editingDraft ? invoiceBalanceDue(editingInvoice) : 0;
  const newOutstanding = total - paidAmount;
  /** Anything left owing has to be owed by someone nameable — see the check in saveInvoice. */
  const creditSaleNeedsCustomer = total > 0 && paidAmount < total && !selectedCustomer;

  // Place of supply comes from the company's own GSTIN — the first two digits are the statutory
  // state code. No GSTIN on the company means no place of supply to state, so the whole clause
  // is dropped rather than guessed.
  const companyStateCode = (activeCompany?.gstin ?? '').trim().slice(0, 2);
  const customerStateCode = (selectedCustomer?.gstin ?? '').trim().slice(0, 2);
  const placeOfSupply = GST_STATE_NAMES[companyStateCode] ? `${GST_STATE_NAMES[companyStateCode]} (${companyStateCode})` : '';
  // Intra- vs inter-state decides whether GST is displayed as CGST + SGST or as a single IGST
  // line. This is a labelling decision only — the stored total is the same either way. With a
  // GSTIN missing on either side there is nothing to compare, so nothing is claimed.
  const supplyKind: 'intra' | 'inter' | 'unknown' = companyStateCode && customerStateCode
    ? (companyStateCode === customerStateCode ? 'intra' : 'inter')
    : 'unknown';
  const halfGstPercent = Number((gstPercent / 2).toFixed(3));

  const filteredInvoices = invoices.filter((invoice) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    const items = invoiceItems.filter((item) => item.invoice_id === invoice.id).map((item) => item.name).join(' ');
    return invoice.id.toLowerCase().includes(query) || invoice.customer.toLowerCase().includes(query) || items.toLowerCase().includes(query);
  });

  // A draft is a parked sale, not a sale. It holds stock, but nothing has been billed and nothing
  // is owed — so every money figure on this screen is summed over the live invoices only.
  const isDraft = (invoice: Invoice) => invoice.status === DRAFT_STATUS;
  const liveInvoices = invoices.filter((invoice) => !isDraft(invoice));
  const draftInvoices = invoices.filter(isDraft);
  const draftInvoiceIds = new Set(draftInvoices.map((invoice) => invoice.id));

  const totalRevenue = liveInvoices.reduce((t, inv) => t + Number(inv.total || 0), 0);
  const avgOrderValue = liveInvoices.length > 0 ? totalRevenue / liveInvoices.length : 0;
  const outstandingDue = liveInvoices.reduce((t, inv) => t + invoiceBalanceDue(inv), 0);
  const productRevenue = new Map<string, number>();
  for (const item of invoiceItems) {
    // Line items belonging to a draft are left out for the same reason: nothing has been sold yet.
    if (draftInvoiceIds.has(item.invoice_id)) continue;
    productRevenue.set(item.name, (productRevenue.get(item.name) ?? 0) + Number(item.line_total || 0));
  }
  const topProduct = Array.from(productRevenue.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topProductRevenue = topProduct ? (productRevenue.get(topProduct) ?? 0) : 0;

  // One definition of paid / partly paid / unpaid for the whole screen, so the KPI contexts, the
  // filter tabs and the row badges can never disagree with each other.
  const balanceOf = (invoice: Invoice) => invoiceBalanceDue(invoice);
  const isSettled = (invoice: Invoice) => balanceOf(invoice) <= 0;
  const isPartlyPaid = (invoice: Invoice) => Number(invoice.paid) > 0 && balanceOf(invoice) > 0;
  const isUnpaid = (invoice: Invoice) => Number(invoice.paid) <= 0 && balanceOf(invoice) > 0;

  const settledCount = liveInvoices.filter(isSettled).length;
  const partialCount = liveInvoices.filter(isPartlyPaid).length;
  const unpaidCount = liveInvoices.filter(isUnpaid).length;
  const dueCount = partialCount + unpaidCount;

  // Tab counts are taken from the search result rather than the whole ledger, so the number on a
  // tab is always exactly how many rows clicking it will show. The payment tabs are drawn from the
  // live invoices only: a draft owes nothing, so it belongs in none of them and has its own tab.
  const filteredLiveInvoices = filteredInvoices.filter((invoice) => !isDraft(invoice));
  const paymentTabs: Array<{ key: PaymentFilter; label: string; title: string; rows: Invoice[] }> = [
    { key: 'all', label: 'All', title: 'All invoices', rows: filteredInvoices },
    { key: 'paid', label: 'Paid', title: 'Fully settled invoices', rows: filteredLiveInvoices.filter(isSettled) },
    { key: 'partial', label: 'Partial', title: 'Part-paid invoices', rows: filteredLiveInvoices.filter(isPartlyPaid) },
    { key: 'unpaid', label: 'Unpaid', title: 'Invoices with nothing received', rows: filteredLiveInvoices.filter(isUnpaid) },
    { key: 'drafts', label: 'Drafts', title: 'Parked drafts — stock is reserved, nothing is billed', rows: filteredInvoices.filter(isDraft) },
  ];
  const activePaymentTab = paymentTabs.find((tab) => tab.key === paymentFilter) ?? paymentTabs[0];
  const visibleInvoices = activePaymentTab.rows;

  // Paging is clamped rather than reset by an effect: deleting the last invoice on page 4 simply
  // lands the view on the new last page instead of showing an empty table.
  const totalPages = Math.max(1, Math.ceil(visibleInvoices.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagedInvoices = visibleInvoices.slice(pageStart, pageStart + PAGE_SIZE);
  // Drafts are listed but never added into the money on the footer, and the footer says how many
  // rows it left out so the figures can't be misread as covering everything on screen.
  const pagedSales = pagedInvoices.filter((inv) => !isDraft(inv));
  const pagedDraftCount = pagedInvoices.length - pagedSales.length;
  const pageTotal = pagedSales.reduce((sum, inv) => sum + Number(inv.total || 0), 0);
  const pageReceived = pagedSales.reduce((sum, inv) => sum + Number(inv.paid || 0), 0);
  const pageDue = pagedSales.reduce((sum, inv) => sum + Math.max(0, balanceOf(inv)), 0);

  // Only whole units that are still returnable count towards a credit note.
  const selectedReturnItems = returnableItems
    .map((item) => ({
      invoice_item_id: item.invoice_item_id,
      qty: Math.min(item.returnable_qty, Math.max(0, Number(returnQuantities[item.invoice_item_id] ?? 0))),
      condition: returnConditions[item.invoice_item_id] ?? ('resellable' as const),
    }))
    .filter((item) => Number.isInteger(item.qty) && item.qty > 0);
  /** What one unit of this line was actually charged at — its list price less whatever discount
   *  the line carried. The credit note is built from this, so the preview must be too. */
  const returnNetRate = (item: ReturnableInvoiceItem) =>
    Number(item.sold_qty) > 0 ? Number(item.line_total) / Number(item.sold_qty) : Number(item.unit_price);
  const returnItemValue = returnableItems.reduce(
    (sum, item) => sum + (returnQuantities[item.invoice_item_id] ?? 0) * returnNetRate(item),
    0
  );

  const openInvoice = (presetCustomer?: string) => {
    setEditingInvoice(null);
    setCustomer(presetCustomer ?? '');
    // Starts empty on purpose: the part picker adds the first line the moment something is
    // scanned or typed, so an opening blank row would only ever need deleting.
    setLines([]);
    setDiscountPercent(0);
    setGstPercent(18);
    setGstInclusive(false);
    setInvoiceDate(todayIso());
    setPaymentStatus('unpaid');
    setAmountPaid(0);
    setInvoiceError('');
    setShowInvoiceModal(true);
  };

  const openEditInvoice = (invoice: Invoice) => {
    const items = invoiceItems.filter((item) => item.invoice_id === invoice.id);
    setEditingInvoice(invoice);
    setCustomer(invoice.customer === WALK_IN_CUSTOMER ? '' : invoice.customer);
    setInvoiceDate(invoice.date);
    setDiscountPercent(Number(invoice.discount_percent));
    // Was hardcoded to 18, which silently changed the tax on any invoice not saved at 18%.
    // Older invoices have no stored rate at all, so 18 stays the fallback for those only.
    setGstPercent(invoice.gst_percent == null ? 18 : Number(invoice.gst_percent));
    setGstInclusive(invoice.gst_mode === 'inclusive');
    setLines(items.map((item) => ({ part: `${item.part_number} - ${item.name}`, qty: Number(item.qty), price: Number(item.unit_price), discount: Number(item.discount_percent ?? 0) })));
    const paid = Number(invoice.paid);
    const invoiceTotal = Number(invoice.total);
    setPaymentStatus(paid >= invoiceTotal && invoiceTotal > 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid');
    setAmountPaid(paid);
    setInvoiceError('');
    setShowInvoiceModal(true);
  };

  const quoteItemPayload = (sourceLines: InvoiceLine[]) => sourceLines
    .filter((line) => line.part.trim())
    .map((line) => {
      const product = products.find((p) => `${p.part_number} - ${p.name}` === line.part);
      return {
        product_id: product?.id ?? null,
        part_number: product?.part_number ?? '',
        name: product?.name ?? line.part,
        qty: line.qty,
        unit_price: line.price,
        line_total: quoteLineNet(line),
        discount_percent: Math.min(100, Math.max(0, Number(line.discount) || 0)),
        discount_amount: quoteLineDiscount(line),
      };
    });

  const openQuotation = () => {
    const date = todayIso();
    const validity = new Date(`${date}T00:00:00`);
    validity.setDate(validity.getDate() + 30);
    setEditingQuotation(null);
    setQuoteCustomer('');
    setQuoteDate(date);
    setQuoteValidity(validity.toISOString().split('T')[0]);
    setQuoteLines([]);
    setQuoteDiscountPercent(0);
    setQuoteGstPercent(18);
    setQuoteGstInclusive(false);
    setQuotationError('');
    setShowQuotationModal(true);
  };

  const loadQuotationFor = async (quote: Quotation, purpose: 'view' | 'edit') => {
    if (!activeCompany) return;
    setLoadingQuotation(true);
    setQuotationError('');
    try {
      const detail = await getQuotation(quote.id, activeCompany.id);
      if (purpose === 'view') {
        setViewingQuotation(detail);
        return;
      }
      if (detail.status === 'converted') {
        setQuotationError('This quotation has already been converted and can no longer be edited.');
        return;
      }
      setEditingQuotation(detail);
      setQuoteCustomer(
        detail.customer_id
          ? customers.find((customer) => customer.id === detail.customer_id)?.name ?? detail.customer
          : detail.customer === WALK_IN_CUSTOMER ? '' : detail.customer,
      );
      setQuoteDate(detail.date);
      setQuoteValidity(detail.validity);
      setQuoteLines(detail.items.map((item) => ({ part: `${item.part_number} - ${item.name}`, qty: Number(item.qty), price: Number(item.unit_price), discount: Number(item.discount_percent ?? 0) })));
      setQuoteDiscountPercent(Number(detail.discount_percent ?? 0));
      setQuoteGstPercent(Number(detail.gst_percent ?? 18));
      setQuoteGstInclusive(detail.gst_mode === 'inclusive');
      setShowQuotationModal(true);
    } catch (error) {
      setQuotationError(error instanceof Error ? error.message : 'Failed to load quotation details.');
    } finally {
      setLoadingQuotation(false);
    }
  };

  const updateQuoteLine = (index: number, patch: Partial<InvoiceLine>) => {
    setQuoteLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  };

  // A quotation is priced from the same catalogue and turns into an invoice unchanged, so it gets
  // the same entry: scan or type, Enter. Same merge rule too — quoting the same part twice means
  // a quantity, not two identical rows the customer has to read past.
  const addQuotePart = (part: PartOption) => setQuoteLines((current) => addPartToLines(current, part).lines);
  const addQuoteCustomLine = (description: string) => setQuoteLines((current) => addCustomLine(current, description).lines);

  // Saves the quotation on screen, either parked as a draft or confirmed as final. Deliberately
  // one path for both, exactly like the invoice side: a draft and a confirmed quote are stored
  // and checked identically, and the only difference between them is the status they carry — so
  // "keep it a draft" can never quietly mean "save something different".
  const persistQuotation = async (status: typeof DRAFT_STATUS | typeof QUOTATION_FINAL_STATUS) => {
    if (!activeCompany) return;
    // A confirmed quotation is the one case that cannot be parked again: it has been finished and
    // is ready to turn into an invoice, so pushing it back would hide that from the owner. The
    // button is not offered either, and the database refuses it as well.
    if (status === DRAFT_STATUS && editingQuotation && editingQuotation.status !== DRAFT_STATUS) return;

    const unmatchedLine = quoteLines.find((line) => line.part.trim() && !partOptions.some((part) => part.value === line.part));
    if (unmatchedLine) {
      setQuotationError(`"${unmatchedLine.part}" doesn't match a part in Inventory — pick one from the dropdown list.`);
      return;
    }
    const items = quoteItemPayload(quoteLines);
    if (items.length === 0 || quoteTotal <= 0) {
      setQuotationError('Add at least one part with a quantity and price before saving the quotation.');
      return;
    }
    if (!quoteCustomer.trim()) {
      setQuotationError('Choose a customer for this quotation.');
      return;
    }
    if (quoteValidity < quoteDate) {
      setQuotationError('The validity date cannot be before the quotation date.');
      return;
    }

    const parking = status === DRAFT_STATUS;
    const wasDraft = Boolean(editingQuotation && editingQuotation.status === DRAFT_STATUS);
    if (parking) setSavingQuoteDraft(true); else setSavingQuotation(true);
    setQuotationError('');
    try {
      const quote = await saveQuotation({
        companyId: activeCompany.id,
        quotationId: editingQuotation?.id ?? null,
        isEdit: Boolean(editingQuotation),
        customerId: customers.find((entry) => entry.name === quoteCustomer)?.id ?? null,
        customerLabel: quoteCustomer,
        date: quoteDate,
        validity: quoteValidity,
        items,
        subtotal: quoteSubtotal,
        discountPercent: quoteDiscountPercent,
        discountAmount: quoteDiscountAmount,
        gstPercent: quoteGstPercent,
        gstAmount: quoteGstAmount,
        gstMode: quoteGstInclusive ? 'inclusive' : 'exclusive',
        status,
        total: quoteTotal,
      });
      await reloadQuotations();
      setShowQuotationModal(false);
      setEditingQuotation(null);
      setActiveTab('quotations');
      setFeedback(
        parking
          ? editingQuotation
            ? `${quote.id} saved — still a draft, so it can't be turned into an invoice yet.`
            : `${quote.id} parked as a draft for ${quoteCustomer} — finish it whenever you like.`
          : wasDraft
            ? `${quote.id} confirmed — the draft is now a final quotation, ready to print or convert.`
            : `${quote.id} ${editingQuotation ? 'updated' : 'saved'} — inventory is unchanged until conversion.`
      );
    } catch (error) {
      setQuotationError(error instanceof Error ? error.message : 'Failed to save quotation.');
    } finally {
      if (parking) setSavingQuoteDraft(false); else setSavingQuotation(false);
    }
  };

  const saveQuote = (event: FormEvent) => {
    event.preventDefault();
    void persistQuotation(QUOTATION_FINAL_STATUS);
  };

  const convertQuote = async (quote: Quotation) => {
    if (!activeCompany || quote.status === 'converted') return;
    // Converting is the step that draws stock and puts the total on the customer's account, so an
    // unfinished quote must not reach it. The database refuses this too — this only says so in
    // plain words instead of surfacing a rejection after the fact.
    if (isQuoteDraft(quote)) {
      setQuotationError(`${quote.id} is still a draft. Open it and press Confirm Quotation before turning it into an invoice.`);
      return;
    }
    if (quote.validity < todayIso() && !window.confirm(`${quote.id} expired on ${quote.validity}. Convert it anyway?`)) return;
    if (!window.confirm(`Create an invoice from ${quote.id}? This will deduct the saved quote quantities from stock.`)) return;
    setConvertingQuotationId(quote.id);
    setQuotationError('');
    try {
      const result = await convertQuotation(quote.id, activeCompany.id);
      await Promise.all([reloadQuotations(), reloadInvoices(), reloadInvoiceItems(), reloadCustomers(), reloadProducts()]);
      setFeedback(`${quote.id} converted to ${result.invoiceId}. Stock and the customer balance were updated once.`);
      setActiveTab('invoices');
    } catch (error) {
      setQuotationError(error instanceof Error ? error.message : 'Quotation conversion failed. No stock was changed.');
    } finally {
      setConvertingQuotationId(null);
    }
  };

  const confirmUndoCredit = async () => {
    if (!creditToUndo || !activeCompany || undoingCredit) return;
    setCreditError('');
    setUndoingCredit(true);
    try {
      const result = await deleteSalesReturn(activeCompany.id, creditToUndo.id);
      await Promise.all([reloadSalesReturns(), reloadInvoices(), reloadCustomers(), reloadProducts()]);
      setFeedback(result.invoice_restored
        ? `${result.id} undone — the goods are off the shelf again and ${creditToUndo.invoice_id} is back to what it was billed for.`
        : `${result.id} undone and the stock corrected. ${creditToUndo.invoice_id} was rebuilt by an edit after this credit note, so its total already excluded it and was left alone.`);
      setCreditToUndo(null);
    } catch (error) {
      setCreditError(error instanceof Error ? error.message : 'This credit note was not undone.');
    } finally {
      setUndoingCredit(false);
    }
  };

  const updateLine = (index: number, patch: Partial<InvoiceLine>) => {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  };

  // The line payload the atomic save expects — the same mapping the create and edit paths have
  // always used, now shared with Save as Draft so a parked sale is stored exactly like a billed one.
  const invoiceItemPayload = (sourceLines: InvoiceLine[]) => sourceLines
    .filter((line) => line.part.trim())
    .map((line) => {
      const product = products.find((p) => `${p.part_number} - ${p.name}` === line.part);
      return {
        product_id: product?.id ?? null,
        part_number: product?.part_number ?? '',
        name: product?.name ?? line.part,
        qty: line.qty,
        unit_price: line.price,
        // What is actually charged for the line, already net of its own discount. Everything that
        // reads line_total later — the printable invoice subtotal, sales returns, credit notes —
        // therefore needs no knowledge of line discounts at all.
        line_total: lineNet(line),
        discount_percent: lineDiscountPercent(line),
        discount_amount: lineGross(line) - lineNet(line),
      };
    });

  // Parks the sale on screen without billing it. Deliberately the same atomic call as Create
  // Invoice — so the FIFO stock is reserved there and then, which is what the owner asked for —
  // with nothing received and nothing added to the customer's balance, because nothing is owed
  // until the sale is confirmed.
  const saveDraftInvoice = async () => {
    // A live invoice is the one case that cannot be parked: it has already been billed and is
    // already on a customer's account, so turning it back into a draft would silently erase a
    // real debt. A brand-new sale and an existing draft can both be parked.
    if (!activeCompany || (editingInvoice && !editingDraft)) return;

    const unmatchedLine = lines.find((line) => line.part.trim() && !partOptions.some((part) => part.value === line.part));
    if (unmatchedLine) {
      setInvoiceError(`"${unmatchedLine.part}" doesn't match a part in Inventory — pick one from the dropdown list.`);
      return;
    }

    const items = invoiceItemPayload(lines);
    if (items.length === 0 || total <= 0) {
      setInvoiceError('Add at least one part with a quantity and price before parking this sale as a draft.');
      return;
    }

    setInvoiceError('');
    setSavingDraft(true);
    try {
      // Re-parking an existing draft is an edit of that same record: the atomic save reverses
      // the stock it had reserved and draws it again for the new lines, so the reservation always
      // matches what the draft currently says. Both outstandings stay 0 — a draft never put
      // anything on the customer's account, and it still does not.
      const editingRow = editingDraft ? editingInvoice : null;
      const oldCustomerRow = editingRow ? customers.find((c) => c.name === editingRow.customer) : undefined;

      const invoice = await saveSalesInvoice({
        companyId: activeCompany.id,
        invoiceId: editingRow ? editingRow.id : null,
        isEdit: Boolean(editingRow),
        customerLabel,
        oldCustomerId: oldCustomerRow?.id ?? null,
        newCustomerId: selectedCustomer?.id ?? null,
        oldOutstanding: 0,
        newOutstanding: 0,
        date: invoiceDate,
        items,
        total,
        paid: 0,
        status: DRAFT_STATUS,
        mode: 'Credit',
        discountPercent,
        discountAmount,
        gstPercent,
        gstAmount,
        gstMode: gstInclusive ? 'inclusive' : 'exclusive',
      });

      const draftId = String(invoice.id);
      // No customer reload: parking a draft leaves every balance exactly as it was.
      await Promise.all([reloadInvoices(), reloadInvoiceItems(), reloadProducts()]);
      setShowInvoiceModal(false);
      setEditingInvoice(null);
      setActiveTab('invoices');
      setPaymentFilter('drafts');
      setPage(1);
      setFeedback(
        editingRow
          ? `${draftId} saved — still a draft, nothing billed yet.`
          : `${draftId} parked as a draft for ${customerLabel} — stock is reserved, nothing is billed yet.`
      );
    } catch (error) {
      setInvoiceError(error instanceof Error ? error.message : 'Failed to park this sale as a draft — please check Sales and Inventory before retrying.');
    } finally {
      setSavingDraft(false);
    }
  };

  const saveInvoice = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeCompany) return;

    const unmatchedLine = lines.find((line) => line.part.trim() && !partOptions.some((part) => part.value === line.part));
    if (unmatchedLine) {
      setInvoiceError(`"${unmatchedLine.part}" doesn't match a part in Inventory — pick one from the dropdown list.`);
      return;
    }

    const items = invoiceItemPayload(lines);
    const status = paidAmount >= total && total > 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

    // A sale that isn't fully paid is money owed — and money owed by "Walk-in Customer" can never
    // be chased, shows against no ledger, and lands in no customer's history. A cash sale that
    // settles on the spot is legitimately anonymous and stays fast; credit is not.
    // Deliberately the same flag the field hint and the save button read, so the rule can only
    // ever be stated in one place.
    if (creditSaleNeedsCustomer) {
      setInvoiceError(
        'This sale is not fully paid, so it needs a named customer — an unpaid walk-in sale cannot be chased or tracked. Pick a customer above, or use + New to add one.'
      );
      return;
    }

    setInvoiceError('');
    setSavingInvoice(true);
    try {
      if (editingInvoice) {
        const oldCustomerRow = customers.find((c) => c.name === editingInvoice.customer);
        const newCustomerRow = customers.find((c) => c.name === customer);
        // Confirming a parked draft is this same edit, carrying the real status and the real
        // outstanding: the stock was reserved when it was parked and the edit path reconciles it.
        const wasDraft = editingInvoice.status === DRAFT_STATUS;

        // Atomic on the database side (jde_save_sales_invoice): fully undoes the old invoice's
        // stock effect, draws fresh FIFO batches for the new lines, and adjusts the customer
        // balance, all as one transaction — a failure partway through leaves nothing half-done.
        await saveSalesInvoice({
          companyId: activeCompany.id,
          invoiceId: editingInvoice.id,
          isEdit: true,
          customerLabel,
          oldCustomerId: oldCustomerRow?.id ?? null,
          newCustomerId: newCustomerRow?.id ?? null,
          oldOutstanding: editingOldOutstanding,
          newOutstanding,
          date: invoiceDate,
          items,
          total,
          paid: paidAmount,
          status,
          mode: editingInvoice.mode,
          discountPercent,
          discountAmount,
          gstPercent,
          gstAmount,
          gstMode: gstInclusive ? 'inclusive' : 'exclusive',
        });

        await Promise.all([reloadInvoices(), reloadInvoiceItems(), reloadCustomers(), reloadProducts()]);
        setShowInvoiceModal(false);
        setEditingInvoice(null);
        if (wasDraft) {
          // It has just left the Drafts tab, so move the list to where it now lives.
          setPaymentFilter('all');
          setPage(1);
        }
        setFeedback(wasDraft ? `${editingInvoice.id} confirmed — the parked draft is now a live invoice.` : `${editingInvoice.id} updated.`);
        return;
      }

      // The id is generated inside jde_save_sales_invoice itself and read back from the result —
      // not guessed client-side — since id is globally unique across every company, not just the
      // ones this browser has loaded.
      const invoice = await saveSalesInvoice({
        companyId: activeCompany.id,
        invoiceId: null,
        isEdit: false,
        customerLabel,
        oldCustomerId: null,
        newCustomerId: selectedCustomer?.id ?? null,
        oldOutstanding: 0,
        newOutstanding,
        date: invoiceDate,
        items,
        total,
        paid: paidAmount,
        status,
        mode: 'Credit',
        discountPercent,
        discountAmount,
        gstPercent,
        gstAmount,
        gstMode: gstInclusive ? 'inclusive' : 'exclusive',
      });

      const createdId = String(invoice.id);
      await Promise.all([reloadInvoices(), reloadInvoiceItems(), reloadCustomers(), reloadProducts()]);
      setShowInvoiceModal(false);
      setActiveTab('invoices');
      setFeedback(`${createdId} generated for ${customerLabel}.`);
      // What the owner asked for: the finished invoice opens as soon as the sale is created,
      // rather than having to be hunted down in the list. It opens the real invoice route on the
      // id the server just returned — the same document the Print button on any row opens, so
      // there is one invoice document in the app rather than two that could drift apart.
      window.open(`/sales/invoice/${createdId}`, '_blank');
    } catch (error) {
      setInvoiceError(error instanceof Error ? error.message : 'Failed to save this invoice — please check Sales and Inventory before retrying.');
    } finally {
      setSavingInvoice(false);
    }
  };

  const openSettleShort = (invoice: Invoice) => {
    setSettlingInvoice(invoice);
    // Starts at nothing handed over today — the case where a customer has already paid what they
    // were going to and just wants the rest closed. Typing what they are paying now is what makes
    // this one step instead of two.
    setSettleReceived(0);
    setSettleReason('');
    setSettleError('');
    setSettleCost(null);
    if (!activeCompany) return;
    // The profit line is a nicety, not a precondition. If this never answers, the dialog reports
    // the money received and says nothing about profit rather than inventing one.
    void getInvoiceCost(activeCompany.id, invoice.id)
      .then(setSettleCost)
      .catch((error) => console.error('Could not work out what this sale cost:', error));
  };

  // What the dialog is about to do, worked out once so the summary the owner reads and the action
  // the button takes can never disagree about the figures.
  const settleDue = settlingInvoice ? invoiceBalanceDue(settlingInvoice) : 0;
  // Capped at the open balance: the database refuses more than that anyway, and a number on
  // screen that the save is going to reject is worse than one that was never offered.
  const settlePayNow = round2(Math.min(Math.max(0, Number(settleReceived) || 0), settleDue));
  const settleClosing = round2(settleDue - settlePayNow);
  const settleTotalReceived = round2((settlingInvoice ? Number(settlingInvoice.paid) : 0) + settlePayNow);
  const settleOutcome = settleCost ? realisedProfit(settleTotalReceived, settleCost) : null;
  const settleCustomerRow = settlingInvoice ? customers.find((c) => c.name === settlingInvoice.customer) : undefined;

  const confirmSettleShort = async () => {
    if (!settlingInvoice || !activeCompany || savingSettlement) return;
    if (settlePayNow > 0 && !settleCustomerRow) {
      setSettleError(`${settlingInvoice.customer} has no customer account, so a payment cannot be recorded against it. Set the amount to 0 to close the balance on its own.`);
      return;
    }
    setSettleError('');
    setSavingSettlement(true);
    // The money goes in first and the closing entry second, deliberately in that order. If the
    // second step fails, the cash is already recorded against the invoice and the balance is
    // simply still open — visible, and finishable. The other order would leave an invoice looking
    // settled with the customer's money missing from it.
    let paymentRecorded = false;
    try {
      if (settlePayNow > 0 && settleCustomerRow) {
        await receiveCustomerPayment({
          companyId: activeCompany.id,
          customerId: settleCustomerRow.id,
          date: todayIso(),
          amount: settlePayNow,
          note: settleReason ? `Settled ${settlingInvoice.id} — ${settleReason}` : `Settled ${settlingInvoice.id}`,
          allocations: [{ invoiceId: settlingInvoice.id, amount: settlePayNow }],
        });
        paymentRecorded = true;
      }
      if (settleClosing > 0) {
        // How much may actually be closed is decided by the database, which locks the invoice
        // first — this amount is only a request.
        await writeOffInvoiceBalance({
          companyId: activeCompany.id,
          invoiceId: settlingInvoice.id,
          amount: settleClosing,
          reason: settleReason,
        });
      }
      await Promise.all([reloadInvoices(), reloadCustomers(), reloadPayments()]);
      // Reports the takings, not the shortfall — and only claims a profit when the cost of the
      // goods is actually known.
      const earned = settleOutcome
        ? ` ${settleOutcome.profit >= 0 ? 'Profit' : 'Loss'} on it: ₹${money(Math.abs(settleOutcome.profit))}.`
        : '';
      setFeedback(`${settlingInvoice.id} settled and closed — ₹${money(settleTotalReceived)} received on this sale.${earned}`);
      setSettlingInvoice(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'This settlement was not recorded.';
      if (paymentRecorded) {
        // Half-done is not the same as failed, and reporting it as failed is how the same payment
        // gets entered twice. The money is really on the invoice, so the dialog is moved on to
        // reflect that: the balance drops by what was paid and the amount resets to zero, which
        // leaves the retry doing only the part that did not go through.
        setSettlingInvoice({ ...settlingInvoice, paid: round2(Number(settlingInvoice.paid) + settlePayNow) });
        setSettleReceived(0);
        await Promise.all([reloadInvoices(), reloadCustomers(), reloadPayments()]);
        setSettleError(`₹${money(settlePayNow)} was recorded against ${settlingInvoice.id} and is safe — do not enter it again. Closing the remaining ₹${money(settleClosing)} did not go through: ${message}`);
      } else {
        setSettleError(message);
      }
    } finally {
      setSavingSettlement(false);
    }
  };

  const confirmDeleteInvoice = async () => {
    if (!deleteCandidate || !activeCompany) return;
    setDeleteError('');
    setDeletingInvoice(true);
    try {
      const custRow = customers.find((c) => c.name === deleteCandidate.customer);
      const discardingDraft = isDraft(deleteCandidate);
      // Atomic on the database side (jde_delete_sales_invoice): restores FIFO stock for every
      // line item and reverses the customer balance before removing the invoice itself. The
      // amount reversed is computed by the database from the invoice's own total/paid — not
      // sent from here — and the database also checks the invoice's own status itself before
      // reversing anything at all: parking a draft never touched the customer's balance (it
      // saves with newOutstanding: 0), so deleting one must not reverse a debt that was never
      // recorded. That check lives server-side rather than as a client-passed flag, so nothing
      // sent from here can talk the database into skipping or applying it wrongly.
      await deleteSalesInvoice(activeCompany.id, deleteCandidate.id, custRow?.id ?? null);
      await Promise.all([reloadInvoices(), reloadInvoiceItems(), reloadCustomers(), reloadProducts()]);
      setFeedback(discardingDraft
        ? `${deleteCandidate.id} discarded — the reserved stock is back in inventory.`
        : `${deleteCandidate.id} deleted — stock and customer balance reversed.`);
      setDeleteCandidate(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : `Failed to delete ${deleteCandidate.id}.`);
    } finally {
      setDeletingInvoice(false);
    }
  };

  const confirmDeletePayment = async () => {
    if (!deletePaymentCandidate || !activeCompany) return;
    setDeletePaymentError('');
    setDeletingPayment(true);
    try {
      // Atomic on the database side (jde_delete_customer_payment): every invoice this payment
      // touched goes back to its prior paid amount/status and the customer balance is corrected
      // by the same total, before the payment itself is removed.
      await deleteCustomerPayment(activeCompany.id, deletePaymentCandidate.id);
      await Promise.all([reloadInvoices(), reloadCustomers(), reloadPayments()]);
      setFeedback(`${deletePaymentCandidate.id} reversed — the invoices it was applied to are back to how they were.`);
      setDeletePaymentCandidate(null);
    } catch (error) {
      setDeletePaymentError(error instanceof Error ? error.message : `Failed to reverse ${deletePaymentCandidate.id}.`);
    } finally {
      setDeletingPayment(false);
    }
  };

  const ledgerSummary = invoices.length > 0
    ? ` · ${liveInvoices.length} ${liveInvoices.length === 1 ? 'invoice' : 'invoices'} on file${dueCount > 0 ? `, ${dueCount} still carrying a balance` : ''}${draftInvoices.length > 0 ? `, ${draftInvoices.length} ${draftInvoices.length === 1 ? 'draft parked' : 'drafts parked'}` : ''}`
    : '';

  const openSalesReturn = async (invoice: Invoice) => {
    if (!activeCompany) return;
    setReturnError('');
    setLoadingReturn(true);
    setReturnReason('');
    setReturnableItems([]);
    setReturnQuantities({});
    setReturnConditions({});
    try {
      const items = await getReturnableInvoiceItems(activeCompany.id, invoice.id);
      if (items.length === 0 || items.every((item) => Number(item.returnable_qty) <= 0)) {
        setFeedback(`${invoice.id} has no remaining items available to return.`);
        return;
      }
      setReturnCandidate(invoice);
      setReturnableItems(items);
      setReturnQuantities(Object.fromEntries(items.map((item) => [item.invoice_item_id, 0])));
    } catch (error) {
      setReturnError(error instanceof Error ? error.message : `Could not load return details for ${invoice.id}.`);
    } finally {
      setLoadingReturn(false);
    }
  };

  const updateReturnQuantity = (item: ReturnableInvoiceItem, value: string) => {
    const parsed = Number(value);
    const qty = Number.isFinite(parsed) ? Math.min(Number(item.returnable_qty), Math.max(0, Math.floor(parsed))) : 0;
    setReturnQuantities((current) => ({ ...current, [item.invoice_item_id]: qty }));
  };

  const saveSalesReturn = async () => {
    if (!activeCompany || !returnCandidate || selectedReturnItems.length === 0) return;
    if (!returnReason.trim()) {
      setReturnError('Add a brief reason for this return.');
      return;
    }
    // Says what will actually happen to each half, because they now differ: damaged goods are
    // credited in full but never go back on the shelf, and that is not something to discover after
    // the fact from a stock figure that did not move.
    const totalUnits = selectedReturnItems.reduce((sum, item) => sum + item.qty, 0);
    const damagedUnits = selectedReturnItems.filter((item) => item.condition === 'damaged').reduce((sum, item) => sum + item.qty, 0);
    const stockLine = damagedUnits === 0
      ? 'All of it goes back into stock, and the customer balance is updated with it.'
      : damagedUnits === totalUnits
        ? 'None of it goes back into stock, because it is all marked damaged. The customer is still credited in full.'
        : `${totalUnits - damagedUnits} of them go back into stock; the ${damagedUnits} marked damaged do not. The customer is credited for all ${totalUnits}.`;
    if (!window.confirm(`Create a credit note for ${totalUnits} returned unit${totalUnits === 1 ? '' : 's'}?

${stockLine}`)) return;

    setSavingReturn(true);
    setReturnError('');
    try {
      const customerId = customers.find((customer) => customer.name === returnCandidate.customer)?.id ?? null;
      const result = await createSalesReturn({
        companyId: activeCompany.id,
        invoiceId: returnCandidate.id,
        customerId,
        reason: returnReason.trim(),
        items: selectedReturnItems,
      });
      await Promise.all([reloadInvoices(), reloadInvoiceItems(), reloadCustomers(), reloadProducts()]);
      setFeedback(
        `${result.id} created for ${returnCandidate.id} — ₹${Number(result.credit_total).toLocaleString()} credited`
        + (damagedUnits > 0 ? `, with ${damagedUnits} damaged unit${damagedUnits === 1 ? '' : 's'} kept out of stock.` : '.')
      );
      setReturnCandidate(null);
    } catch (error) {
      setReturnError(error instanceof Error ? error.message : 'The return was not saved. No stock or customer balance was changed.');
    } finally {
      setSavingReturn(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Accounts receivable</div>
          <h1 className="page-title">Sales Management</h1>
          <p className="page-subtitle">Invoices, billing and quotations{ledgerSummary}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={() => openReceivePayment()}><Wallet size={16} /> Receive Payment</button>
          <button className="btn btn-secondary" onClick={openQuotation}><Plus size={16} /> Create Quotation</button>
          <button className="btn btn-primary" onClick={() => openInvoice()}><Plus size={16} /> Create Sales Invoice</button>
        </div>
      </div>

      {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}
      {returnError && !returnCandidate && <div className="alert alert-danger mb-4" role="alert">{returnError}</div>}
      {quotationError && !showQuotationModal && <div className="alert alert-danger mb-4" role="alert">{quotationError}</div>}

      {/* The two document types this screen holds. Same `activeTab` state the ghost buttons used
          to drive — only the control has changed. */}
      <div className="flex mb-4">
        <div className="tabs" role="tablist" aria-label="Sales documents">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'invoices'}
            className={`tab ${activeTab === 'invoices' ? 'active' : ''}`}
            onClick={() => { setActiveTab('invoices'); setPage(1); }}
          >
            Invoices <span className="tab-count">{invoices.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'quotations'}
            className={`tab ${activeTab === 'quotations' ? 'active' : ''}`}
            onClick={() => setActiveTab('quotations')}
          >
            Quotations <span className="tab-count">{quotations.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'credits'}
            className={`tab ${activeTab === 'credits' ? 'active' : ''}`}
            onClick={() => setActiveTab('credits')}
          >
            Credit Notes <span className="tab-count">{salesReturns.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'ledger'}
            className={`tab ${activeTab === 'ledger' ? 'active' : ''}`}
            onClick={() => setActiveTab('ledger')}
          >
            Customer Ledger
          </button>
        </div>
      </div>

      {activeTab === 'invoices' && (
        <>
          {/* Headline figures, every one of them summed from the invoices and line items this page
              has already loaded — there is no month-on-month delta or trend line here because the
              page holds no historical series to compare against. */}
          {invoices.length > 0 && (
            <div className="kpi-grid">
              <div className="kpi-card" style={{ '--kpi-color': 'var(--chart-amber)', '--kpi-color-bg': 'var(--amber-tint)' } as React.CSSProperties}>
                <div className="flex justify-between items-center">
                  <span className="kpi-label">Total Revenue</span>
                  <div className="kpi-icon-wrap"><IndianRupee size={18} /></div>
                </div>
                <div className="kpi-value">₹{money(totalRevenue)}</div>
                <span className="kpi-context">Billed across every invoice recorded for this company</span>
              </div>

              <div className="kpi-card" style={{ '--kpi-color': 'var(--chart-blue)', '--kpi-color-bg': 'var(--color-info-bg)' } as React.CSSProperties}>
                <div className="flex justify-between items-center">
                  <span className="kpi-label">Transactions</span>
                  <div className="kpi-icon-wrap"><Receipt size={18} /></div>
                </div>
                <div className="kpi-value">{invoices.length}</div>
                <span className="kpi-context">{settledCount} paid · {partialCount} partial · {unpaidCount} unpaid</span>
              </div>

              <div className="kpi-card" style={{ '--kpi-color': 'var(--chart-green)', '--kpi-color-bg': 'var(--em-tint)' } as React.CSSProperties}>
                <div className="flex justify-between items-center">
                  <span className="kpi-label">Avg. Order Value</span>
                  <div className="kpi-icon-wrap"><TrendingUp size={18} /></div>
                </div>
                <div className="kpi-value">₹{Number(avgOrderValue).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                <span className="kpi-context">Total revenue divided by {invoices.length} {invoices.length === 1 ? 'invoice' : 'invoices'}</span>
              </div>

              <div className="kpi-card" style={{ '--kpi-color': 'var(--chart-red)', '--kpi-color-bg': 'var(--rose-tint)' } as React.CSSProperties}>
                <div className="flex justify-between items-center">
                  <span className="kpi-label">Outstanding Due</span>
                  <div className="kpi-icon-wrap"><AlertTriangle size={18} /></div>
                </div>
                <div className="kpi-value">₹{money(outstandingDue)}</div>
                <div className={`kpi-change ${dueCount > 0 ? 'negative' : 'positive'}`}>
                  {dueCount > 0 ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                  <span>{dueCount > 0 ? `${dueCount} open` : 'All settled'}</span>
                </div>
                <span className="kpi-context">Billed but not yet received</span>
              </div>

              <div className="kpi-card" style={{ '--kpi-color': 'var(--chart-violet)', '--kpi-color-bg': 'var(--panel-2)' } as React.CSSProperties}>
                <div className="flex justify-between items-center">
                  <span className="kpi-label">Top Product</span>
                  <div className="kpi-icon-wrap"><Package size={18} /></div>
                </div>
                <div className="kpi-value truncate" style={{ fontSize: '16px' }}>{topProduct ?? '—'}</div>
                <span className="kpi-context">
                  {topProduct
                    ? `₹${money(topProductRevenue)} across recorded invoice lines`
                    : 'No invoice line items recorded yet'}
                </span>
              </div>
            </div>
          )}

          {outstandingDue > 0 && (
            <div className="alert alert-warning mb-4" role="status">
              <AlertTriangle size={16} style={{ flex: 'none', marginTop: '1px' }} />
              <span>
                ₹{money(outstandingDue)} is outstanding across {dueCount} {dueCount === 1 ? 'invoice' : 'invoices'}
                {unpaidCount > 0 && partialCount > 0 ? ` — ${unpaidCount} with nothing received and ${partialCount} part paid` : ''}.
              </span>
              <button
                type="button"
                className="alert-action"
                onClick={() => { setPaymentFilter(unpaidCount > 0 ? 'unpaid' : 'partial'); setPage(1); }}
              >
                {unpaidCount > 0 ? 'Show unpaid' : 'Show part paid'} <ArrowRight size={14} />
              </button>
            </div>
          )}

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="tbl-toolbar">
              <div className="tbl-toolbar-title">
                <strong>{activePaymentTab.title}</strong>
                <small>Paid column compares what was received against what was billed</small>
              </div>

              <div className="tabs" role="tablist" aria-label="Filter by payment status">
                {paymentTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={paymentFilter === tab.key}
                    className={`tab ${paymentFilter === tab.key ? 'active' : ''}`}
                    onClick={() => { setPaymentFilter(tab.key); setPage(1); }}
                  >
                    {tab.label}<span className="tab-count">{tab.rows.length}</span>
                  </button>
                ))}
              </div>

              <div className="tbl-tools">
                <div className="search-bar" style={{ minWidth: '240px' }}>
                  <Search className="search-bar-icon" size={16} />
                  <input
                    type="text"
                    placeholder="Search invoice, customer, product..."
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  />
                </div>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="erp-table" style={{ minWidth: '1180px' }}>
                <thead>
                  <tr>
                    <th>Invoice No.</th>
                    <th>Customer</th>
                    <th>Date</th>
                    <th>Products</th>
                    <th className="text-right">Units</th>
                    <th className="text-right">Discount</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Paid</th>
                    <th>Status</th>
                    <th className="text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>{pagedInvoices.map((invoice) => {
                  const balance = invoiceBalanceDue(invoice);
                  const writtenOff = invoiceWrittenOff(invoice);
                  // Editing rebuilds an invoice's lines from scratch, which would detach every
                  // return recorded against them and let the same goods be returned again — it
                  // already happened three times on one invoice. Closed here as well as in the
                  // database, so the reason is readable instead of an error after the fact.
                  const returnCount = salesReturns.filter((r) => r.invoice_id === invoice.id).length;
                  const items = invoiceItems.filter((item) => item.invoice_id === invoice.id);
                  const productLabel = items[0]?.name ?? (invoice.items > 0 ? 'Legacy sale' : '—');
                  const customerRow = customers.find((c) => c.name === invoice.customer);
                  const invoiceTotal = Number(invoice.total);
                  // How much of this invoice has actually been received, as a share of what was
                  // billed. A zero-value invoice has no ratio to show, so its bar reads empty.
                  const receivedPercent = invoiceTotal > 0
                    ? Math.max(0, Math.min(100, Math.round((Number(invoice.paid) / invoiceTotal) * 100)))
                    : 0;
                  return <tr key={invoice.id}>
                    <td><span className="pn-chip">{invoice.id}</span></td>
                    <td>
                      <div className="font-semibold">{invoice.customer}</div>
                      {customerRow?.address
                        ? <div className="text-muted text-sm flex items-center gap-2" style={{ maxWidth: '240px', marginTop: '2px' }}>
                            <MapPin size={12} style={{ flex: 'none' }} />
                            <span className="truncate">{customerRow.address}</span>
                          </div>
                        : invoice.customer === WALK_IN_CUSTOMER
                          ? <div className="text-muted text-sm" style={{ marginTop: '2px' }}>Counter sale</div>
                          : null}
                    </td>
                    <td className="text-muted">{invoice.date}</td>
                    <td>
                      <span style={{ fontWeight: 600 }}>{productLabel}</span>
                      {items.length > 0 && <span className="badge badge-muted" style={{ marginLeft: '6px' }}>{items.length} item{items.length > 1 ? 's' : ''}</span>}
                    </td>
                    <td className="text-right">{invoice.items}</td>
                    <td className="text-right">
                      {Number(invoice.discount_amount) > 0
                        ? <span className="text-danger">-₹{money(Number(invoice.discount_amount))} ({Number(invoice.discount_percent).toFixed(0)}%)</span>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className="text-right font-semibold">₹{money(invoiceTotal)}</td>
                    <td>
                      {/* The bar is this invoice's own received-against-billed share, so a full bar
                          always means settled no matter how large the invoice is. */}
                      <div className={`qty-cell${Number(invoice.paid) <= 0 ? ' is-out' : ''}`}>
                        <strong>₹{money(Number(invoice.paid))}</strong>
                        <div className={`meter${balance <= 0 ? '' : Number(invoice.paid) <= 0 ? ' meter--out' : ' meter--low'}`} aria-hidden="true">
                          <i style={{ width: `${receivedPercent}%` }} />
                        </div>
                        {/* Said out loud rather than folded into "paid": this money never arrived. */}
                        {writtenOff > 0 && <div className="text-muted text-sm" style={{ marginTop: '2px' }}>₹{money(writtenOff)} written off</div>}
                      </div>
                    </td>
                    <td>
                      {balance <= 0
                        ? writtenOff > 0
                          ? <span className="badge badge-success"><CheckCircle2 size={12} />Settled</span>
                          : <span className="badge badge-success"><CheckCircle2 size={12} />Paid</span>
                        : Number(invoice.paid) > 0
                          ? <span className="badge badge-warning"><AlertTriangle size={12} />Due ₹{money(balance)}</span>
                          : <span className="badge badge-danger"><XCircle size={12} />Unpaid</span>}
                    </td>
                    <td className="text-center"><div className="flex justify-between gap-1 items-center">
                      <button className="btn btn-ghost btn-sm" aria-label={`View ${invoice.id}`} title="View invoice" onClick={() => setViewingInvoice(invoice)}><Eye size={14} /></button>
                      <button
                        className="btn btn-ghost btn-sm"
                        aria-label={`Edit ${invoice.id}`}
                        title={returnCount > 0
                          ? `Edit unavailable — ${returnCount} return${returnCount === 1 ? '' : 's'} recorded against this invoice. Delete the return first if it really must be changed.`
                          : writtenOff > 0
                            ? 'Edit unavailable — this invoice was settled short, so its amounts are fixed'
                            : items.length > 0 ? 'Edit invoice' : "Edit unavailable — this invoice predates line-item tracking"}
                        disabled={items.length === 0 || writtenOff > 0 || returnCount > 0}
                        style={items.length === 0 || writtenOff > 0 || returnCount > 0 ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                        onClick={() => items.length > 0 && writtenOff === 0 && returnCount === 0 && openEditInvoice(invoice)}
                      ><Pencil size={14} /></button>
                      <button
                        className="btn btn-ghost btn-sm"
                        aria-label={`Return items from ${invoice.id}`}
                        title={items.length > 0 ? 'Create partial return / credit note' : 'Return unavailable — this invoice predates line-item tracking'}
                        disabled={items.length === 0 || loadingReturn}
                        style={items.length === 0 ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                        onClick={() => items.length > 0 && openSalesReturn(invoice)}
                      ><Undo2 size={14} /></button>
                      <button className="btn btn-ghost btn-sm" aria-label={`Print ${invoice.id}`} title="Print invoice" onClick={() => window.open(`/sales/invoice/${invoice.id}`, '_blank')}><Printer size={14} /></button>
                      <button className="btn btn-ghost btn-sm" aria-label={`Delete ${invoice.id}`}
                        title={returnCount > 0 ? 'Delete unavailable — goods have been returned against this invoice' : 'Delete invoice'}
                        disabled={returnCount > 0}
                        style={returnCount > 0 ? { color: 'var(--color-danger)', opacity: 0.4, cursor: 'not-allowed' } : { color: 'var(--color-danger)' }}
                        onClick={() => returnCount === 0 && setDeleteCandidate(invoice)}><Trash2 size={14} /></button>
                    </div></td>
                  </tr>;
                })}
                {pagedInvoices.length === 0 && (
                  <tr><td colSpan={10}><div className="empty-state">
                    <div className="empty-state-icon"><Receipt size={22} /></div>
                    <p className="empty-state-title">
                      {invoicesLoading ? 'Loading invoices…' : search ? 'No invoices match your search' : paymentFilter !== 'all' ? 'Nothing in this view' : 'No invoices yet'}
                    </p>
                    <p className="empty-state-desc">
                      {invoicesLoading
                        ? 'Fetching records for the active company.'
                        : search
                          ? 'Try a different search term.'
                          : paymentFilter !== 'all'
                            ? 'No invoice on file falls into this payment status.'
                            : 'Create your first sales invoice to get started.'}
                    </p>
                  </div></td></tr>
                )}
                </tbody>
              </table>
            </div>

            {visibleInvoices.length > 0 && (
              <div className="pager">
                <div className="pager-info">
                  Showing <strong>{pageStart + 1}–{pageStart + pagedInvoices.length}</strong> of <strong>{visibleInvoices.length}</strong> invoices
                  {' · '}page total <strong>₹{money(pageTotal)}</strong> · received <strong>₹{money(pageReceived)}</strong> · balance due <strong>₹{money(pageDue)}</strong>
                  {/* Said out loud, because otherwise these figures look like they cover every
                      row on screen — a draft is not a sale and is deliberately not counted. */}
                  {pagedDraftCount > 0 && (
                    <> · excludes {pagedDraftCount} {pagedDraftCount === 1 ? 'draft' : 'drafts'} on this page</>
                  )}
                </div>
                {totalPages > 1 && (
                  <div className="pager-controls">
                    <button type="button" className="pager-btn" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
                      <ChevronLeft size={14} />
                    </button>
                    {pageWindow(currentPage, totalPages).map((entry, index) => (
                      entry === 'gap'
                        ? <span key={`gap-${index}`} className="pager-info">…</span>
                        : (
                          <button
                            key={entry}
                            type="button"
                            className={`pager-btn${entry === currentPage ? ' active' : ''}`}
                            aria-current={entry === currentPage ? 'page' : undefined}
                            aria-label={`Page ${entry}`}
                            onClick={() => setPage(entry)}
                          >
                            {entry}
                          </button>
                        )
                    ))}
                    <button type="button" className="pager-btn" aria-label="Next page" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>
                      <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'quotations' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="tbl-toolbar">
            <div className="tbl-toolbar-title">
              <strong>Quotations</strong>
              <small>Convert an accepted quote into a sales invoice — stock moves only on conversion</small>
            </div>
            <div className="tbl-tools">
              <button className="btn btn-ghost btn-sm" onClick={() => setActiveTab('invoices')}><ArrowLeft size={14} /> Back to Invoices</button>
              <button className="btn btn-primary btn-sm" onClick={openQuotation}><Plus size={14} /> Create Quotation</button>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="erp-table" style={{ minWidth: '900px' }}>
              <thead><tr><th>Quote #</th><th>Customer Name</th><th>Quote Date</th><th>Valid Until</th><th className="text-right">Total Amount</th><th>Status</th><th className="text-center">Actions</th></tr></thead>
              <tbody>{quotations.map((quote) => <tr key={quote.id}>
                <td><span className="pn-chip">{quote.id}</span></td><td style={{ fontWeight: 600 }}>{quote.customer}</td><td className="text-muted">{quote.date}</td><td>{quote.validity}</td><td className="text-right font-semibold">₹{money(Number(quote.total))}</td>
                <td><span className={`badge ${quoteBadge(quote).className}`}>{quoteBadge(quote).label}</span></td>
                <td className="text-center"><div className="flex justify-between gap-1 items-center">
                  <button className="btn btn-ghost btn-sm" title="View quotation" aria-label={`View ${quote.id}`} disabled={loadingQuotation} onClick={() => void loadQuotationFor(quote, 'view')}><Eye size={14} /></button>
                  <button className="btn btn-ghost btn-sm" title="Edit quotation" aria-label={`Edit ${quote.id}`} disabled={loadingQuotation || quote.status === 'converted'} onClick={() => void loadQuotationFor(quote, 'edit')}><Pencil size={14} /></button>
                  <button className="btn btn-ghost btn-sm" title="Print quotation" aria-label={`Print ${quote.id}`} onClick={() => window.open(`/sales/quotation/${quote.id}`, '_blank')}><Printer size={14} /></button>
                  {/* A draft cannot be converted: that is the step that draws stock and bills the
                      customer, and an unfinished quote has no business doing either. */}
                  <button
                    className="btn btn-secondary btn-sm"
                    title={isQuoteDraft(quote) ? 'Still a draft — open it and press Confirm Quotation first' : 'Create an invoice from this quotation'}
                    disabled={convertingQuotationId === quote.id || quote.status === 'converted' || isQuoteDraft(quote)}
                    onClick={() => void convertQuote(quote)}
                  >{convertingQuotationId === quote.id ? 'Converting…' : quote.status === 'converted' ? 'Converted' : 'Convert'}</button>
                </div></td>
              </tr>)}
              {quotations.length === 0 && (
                <tr><td colSpan={7}><div className="empty-state"><p className="empty-state-title">{quotationsLoading ? 'Loading quotations…' : 'No quotations yet'}</p><p className="empty-state-desc">{quotationsLoading ? 'Fetching records for the active company.' : 'This company has no quotations on file.'}</p></div></td></tr>
              )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'credits' && (
        <div className="card">
          <div className="tbl-toolbar">
            <div className="tbl-toolbar-title">
              <strong>Credit notes</strong>
              <small>Goods that came back. Each one put stock on the shelf and took the amount off the invoice it came from.</small>
            </div>
          </div>
          {salesReturns.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px 20px' }}>
              <p className="empty-state-title">No goods have come back yet</p>
              <p className="empty-state-desc">A credit note is written from an invoice, using Return on its row.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="erp-table" style={{ minWidth: '720px' }}>
                <thead>
                  <tr>
                    <th style={{ width: '120px' }}>Credit note</th>
                    <th style={{ width: '120px' }}>Against</th>
                    <th style={{ width: '150px' }}>When</th>
                    <th>Reason</th>
                    <th className="text-right" style={{ width: '130px' }}>Credited</th>
                    <th style={{ width: '110px' }} aria-label="Undo"></th>
                  </tr>
                </thead>
                <tbody>
                  {[...salesReturns]
                    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
                    .map((credit) => {
                      // Two credit notes written minutes apart against one invoice, for the same
                      // money, are what a mis-click looks like. Said here rather than left for
                      // somebody to notice across rows.
                      const siblings = duplicateCreditNotes(credit, salesReturns);
                      return (
                        <tr key={credit.id}>
                          <td><span className="pn-chip">{credit.id}</span></td>
                          <td><span className="pn-chip">{credit.invoice_id}</span></td>
                          <td className="text-muted text-sm">{formatDateTime(credit.created_at)}</td>
                          <td>
                            {credit.reason || <span className="text-muted">—</span>}
                            {siblings.length > 0 && (
                              <div className="line-warning is-stock">
                                <AlertTriangle size={12} aria-hidden="true" /> {siblings.length + 1} credit notes on {credit.invoice_id} for the same ₹{money(Number(credit.credit_total))} — the goods may have been put back more than once
                              </div>
                            )}
                          </td>
                          <td className="text-right font-semibold">₹{paise(Number(credit.credit_total))}</td>
                          <td className="text-center">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ color: 'var(--color-danger)' }}
                              onClick={() => { setCreditError(''); setCreditToUndo(credit); }}
                            ><Undo2 size={13} /> Undo</button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'ledger' && (() => {
        const ledgerCustomer = customers.find((customer) => customer.id === ledgerCustomerId) ?? null;
        const entries = ledgerCustomer ? buildCustomerLedger(ledgerCustomer.name, invoices, payments, paymentAllocations) : [];
        let running = 0;

        return (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="tbl-toolbar">
              <div className="tbl-toolbar-title">
                <strong>Customer Ledger</strong>
                <small>Every invoice and payment for one customer, in order, with a running balance</small>
              </div>
              <div className="tbl-tools" style={{ minWidth: '260px' }}>
                <select className="form-input form-select" value={ledgerCustomerId} onChange={(event) => setLedgerCustomerId(event.target.value)}>
                  <option value="">Select a customer…</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}{Number(customer.balance) > 0 ? ` — ₹${money(customer.balance)} due` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!ledgerCustomer ? (
              <div className="empty-state">
                <div className="empty-state-icon"><History size={22} /></div>
                <div className="empty-state-title">Choose a customer</div>
                <p className="empty-state-desc">Their invoices and payments will line up here in order, with a running balance.</p>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-default)' }}>
                  <div>
                    <strong>{ledgerCustomer.name}</strong>
                    <div className="text-muted text-sm">{ledgerCustomer.phone || ledgerCustomer.email || 'No contact details'}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-muted text-sm">Current balance</div>
                      <strong className={Number(ledgerCustomer.balance) > 0 ? 'text-danger' : 'text-success'}>₹{money(ledgerCustomer.balance)}</strong>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={() => openReceivePayment(ledgerCustomer.id)}><Wallet size={14} /> Receive Payment</button>
                  </div>
                </div>

                {entries.length === 0 ? (
                  <div className="empty-state">
                    <p className="empty-state-title">No invoices or payments yet</p>
                    <p className="empty-state-desc">Nothing has been recorded for {ledgerCustomer.name} on this company.</p>
                  </div>
                ) : (
                  <div className="table-wrap" style={{ borderLeft: 'none', borderRight: 'none', borderBottom: 'none', borderRadius: 0 }}>
                    <table className="erp-table">
                      <thead><tr><th>Date</th><th>Entry</th><th className="text-right">Invoiced</th><th className="text-right">Received</th><th className="text-right">Balance</th><th></th></tr></thead>
                      <tbody>
                        {entries.map((entry) => {
                          if (entry.kind === 'invoice') {
                            running += Number(entry.invoice.total);
                            return (
                              <tr key={`inv-${entry.invoice.id}`}>
                                <td>{entry.date}</td>
                                <td><button type="button" className="text-brand font-semibold" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }} onClick={() => setViewingInvoice(entry.invoice)}>{entry.invoice.id}</button></td>
                                <td className="text-right">₹{money(entry.invoice.total)}</td>
                                <td className="text-right text-muted">—</td>
                                <td className="text-right">₹{money(running)}</td>
                                <td></td>
                              </tr>
                            );
                          }
                          running -= Number(entry.payment.amount);
                          return (
                            <tr key={`pay-${entry.payment.id}`}>
                              <td>{entry.date}</td>
                              <td>
                                <span className="font-semibold">{entry.payment.id}</span>
                                <div className="text-muted text-sm">
                                  {entry.appliedTo.length > 0
                                    ? `Applied to ${entry.appliedTo.map((line) => line.invoiceId).join(', ')}`
                                    : 'Not applied to any invoice'}
                                  {entry.payment.note ? ` · ${entry.payment.note}` : ''}
                                </div>
                              </td>
                              <td className="text-right text-muted">—</td>
                              <td className="text-right text-success">₹{money(entry.payment.amount)}</td>
                              <td className="text-right">₹{money(running)}</td>
                              <td className="text-center">
                                <button className="btn btn-ghost btn-sm" aria-label={`Reverse ${entry.payment.id}`} title="Reverse this payment" style={{ color: 'var(--color-danger)' }} onClick={() => setDeletePaymentCandidate(entry.payment)}>
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {viewingQuotation && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '720px' }} role="dialog" aria-modal="true" aria-labelledby="view-quotation-title">
        <div className="modal-header"><div><h3 id="view-quotation-title" className="modal-title">{viewingQuotation.id}</h3><p className="text-muted text-sm">Quotation — inventory is unchanged until conversion.</p></div><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setViewingQuotation(null)}>✕</button></div>
        <div className="modal-body flex flex-col gap-4">
          <div className="form-grid-2"><div><small className="text-muted">Customer</small><div style={{ fontWeight: 600 }}>{viewingQuotation.customer}</div></div><div><small className="text-muted">Quote date</small><div style={{ fontWeight: 600 }}>{viewingQuotation.date}</div></div><div><small className="text-muted">Valid until</small><div style={{ fontWeight: 600 }}>{viewingQuotation.validity}</div></div><div><small className="text-muted">Status</small><div style={{ fontWeight: 600 }}>{quoteBadge(viewingQuotation).label}</div>{isQuoteDraft(viewingQuotation) && <small className="text-muted">Not finished — confirm it before turning it into an invoice.</small>}</div></div>
          <div className="table-wrap"><table className="erp-table"><thead><tr><th>Part</th><th className="text-right">Qty</th><th className="text-right">Unit Price</th><th className="text-right">Line Total</th></tr></thead><tbody>{viewingQuotation.items.map((item, index) => <tr key={`${item.part_number}-${index}`}><td><div style={{ fontWeight: 600 }}>{item.name}</div><small className="text-muted">{item.part_number}</small></td><td className="text-right">{item.qty}</td><td className="text-right">₹{Number(item.unit_price).toLocaleString()}</td><td className="text-right">₹{Number(item.line_total).toLocaleString()}</td></tr>)}</tbody></table></div>
          <div className="report-summary"><div className="report-line"><span>Subtotal{viewingQuotation.items.some((item) => Number(item.discount_percent) > 0) ? ' after item discounts' : ''}</span><span>₹{Number(viewingQuotation.subtotal ?? viewingQuotation.total).toLocaleString()}</span></div>{Number(viewingQuotation.discount_amount) > 0 && <div className="report-line"><span>Whole-quote discount ({Number(viewingQuotation.discount_percent).toFixed(1)}%)</span><span className="text-danger">-₹{Number(viewingQuotation.discount_amount).toLocaleString()}</span></div>}<div className="report-line"><span>GST ({Number(viewingQuotation.gst_percent ?? 0).toFixed(1)}%){viewingQuotation.gst_mode === 'inclusive' ? ' — included in the rates' : ''}</span><span>₹{Number(viewingQuotation.gst_amount ?? 0).toLocaleString()}</span></div><div className="report-line report-strong"><span>Quotation Total</span><strong>₹{Number(viewingQuotation.total).toLocaleString()}</strong></div></div>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => window.open(`/sales/quotation/${viewingQuotation.id}`, '_blank')}><Printer size={14} /> Print</button><button type="button" className="btn btn-primary" onClick={() => setViewingQuotation(null)}>Close</button></div>
      </div></div>}

      {showQuotationModal && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '880px' }} role="dialog" aria-modal="true" aria-labelledby="quotation-modal-title"><form onSubmit={saveQuote} onKeyDown={(event) => keepEnterInsideForm(event, quoteLines.length > 0 && !savingQuotation && !savingQuoteDraft)}>
        <div className="modal-header"><div><h3 id="quotation-modal-title" className="modal-title">{editingQuotation ? `Edit ${editingQuotation.id}` : 'Create Quotation'}</h3><p className="text-muted text-sm">Saving a quotation never changes inventory or customer balances.</p></div><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => { setShowQuotationModal(false); setEditingQuotation(null); }}>✕</button></div>
        <div className="modal-body flex flex-col gap-4">
          {quotationError && <div className="alert alert-danger" role="alert">{quotationError}</div>}
          <div className="form-grid-2"><div className="form-group"><label className="form-label">Customer</label><select required className="form-input form-select" value={quoteCustomer} onChange={(event) => setQuoteCustomer(event.target.value)}><option value="">Select customer…</option>{customers.map((entry) => <option key={entry.id} value={entry.name}>{entry.name}</option>)}</select></div><div className="form-group"><label className="form-label">Quote Date</label><input required type="date" className="form-input" value={quoteDate} onChange={(event) => setQuoteDate(event.target.value)} /></div><div className="form-group"><label className="form-label">Valid Until</label><input required type="date" min={quoteDate} className="form-input" value={quoteValidity} onChange={(event) => setQuoteValidity(event.target.value)} /></div></div>
          <div className="card card-sm bg-surface">
            <h4 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>Quoted Parts</h4>
            {partOptions.length === 0
              ? <p className="text-muted text-sm">Add parts in Inventory before creating a quotation.</p>
              : <PartPicker parts={partOptions} onPick={addQuotePart} onCustom={addQuoteCustomLine} disabled={savingQuotation || savingQuoteDraft} />}
            <div style={{ overflowX: 'auto', marginTop: '10px' }}>
              <table className="erp-table" style={{ minWidth: '620px' }}>
                <thead><tr>
                  <th>Part</th>
                  <th className="text-right" style={{ width: '92px' }}>Qty</th>
                  <th className="text-right" style={{ width: '124px' }}>Rate</th>
                  <th className="text-right" style={{ width: '92px' }}>Disc %</th>
                  <th className="text-right" style={{ width: '132px' }}>Amount</th>
                  <th style={{ width: '52px' }} aria-label="Remove line"></th>
                </tr></thead>
                <tbody>
                  {quoteLines.map((line, index) => {
                    const matched = partOptions.find((part) => part.value === line.part);
                    return <tr key={`${line.part}-${index}`}>
                      <td>
                        {matched ? <>
                          <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}><span className="pn-chip">{matched.partNumber}</span><strong style={{ fontSize: '13px' }}>{matched.name}</strong></div>
                          <div className="text-muted text-sm mt-1">{matched.brand ? `${matched.brand} · ` : ''}{matched.stock} in stock</div>
                        </> : <>
                          <strong style={{ fontSize: '13px' }}>{line.part}</strong>
                          <div className="text-muted text-sm mt-1">One-off line — not in Inventory</div>
                        </>}
                      </td>
                      <td><input required type="number" min="1" className="form-input" style={{ textAlign: 'right' }} aria-label={`Quantity on quoted line ${index + 1}`} value={line.qty} onChange={(event) => updateQuoteLine(index, { qty: Number(event.target.value) })} /></td>
                      <td><input required type="number" min="0" className="form-input" style={{ textAlign: 'right' }} aria-label={`Rate on quoted line ${index + 1}`} value={line.price} onChange={(event) => updateQuoteLine(index, { price: Number(event.target.value) })} /></td>
                      <td><input type="number" min="0" max="100" step="0.1" className="form-input" style={{ textAlign: 'right' }} aria-label={`Discount percent on quoted line ${index + 1}`} value={line.discount ?? 0} onChange={(event) => updateQuoteLine(index, { discount: Math.min(100, Math.max(0, Number(event.target.value))) })} /></td>
                      <td className="text-right font-semibold">
                        {quoteLineDiscount(line) > 0 && <div style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)', textDecoration: 'line-through' }}>₹{paise(quoteLineGross(line))}</div>}
                        ₹{paise(quoteLineNet(line))}
                      </td>
                      <td className="text-center"><button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove quoted line ${index + 1}`} title="Remove this line" style={{ color: 'var(--color-danger)' }} onClick={() => setQuoteLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><X size={14} /></button></td>
                    </tr>;
                  })}
                  {quoteLines.length === 0 && partOptions.length > 0 && (
                    <tr><td colSpan={6}><div className="empty-state" style={{ padding: '22px 20px' }}>
                      <p className="empty-state-title">Nothing quoted yet</p>
                      <p className="empty-state-desc">Scan or type a part number in the box above, then press Enter.</p>
                    </div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="form-grid-2"><div className="form-group"><label className="form-label">Discount (%)</label><input type="number" min="0" max="100" step="0.1" className="form-input" value={quoteDiscountPercent} onChange={(event) => setQuoteDiscountPercent(Math.min(100, Math.max(0, Number(event.target.value))))} /></div><div className="form-group"><label className="form-label">Discount Amount (₹)</label><input className="form-input" value={quoteDiscountAmount.toFixed(2)} disabled /></div><div className="form-group"><label className="form-label">GST Rate (%)</label><input type="number" min="0" max="28" step="0.1" className="form-input" value={quoteGstPercent} onChange={(event) => setQuoteGstPercent(Math.min(28, Math.max(0, Number(event.target.value))))} /><div className="flex gap-2 mt-2" role="group" aria-label="How the quoted rates are priced"><button type="button" className={'btn btn-sm ' + (quoteGstInclusive ? 'btn-secondary' : 'btn-primary')} onClick={() => setQuoteGstInclusive(false)}>GST extra</button><button type="button" className={'btn btn-sm ' + (quoteGstInclusive ? 'btn-primary' : 'btn-secondary')} onClick={() => setQuoteGstInclusive(true)}>GST included</button></div><small className="text-muted">{quoteGstInclusive ? 'Quoted rates already include GST — the tax is taken out of them.' : 'Quoted rates are before GST — the tax is added on top.'}</small></div><div className="form-group"><label className="form-label">GST Amount (₹)</label><input className="form-input" value={quoteGstAmount.toFixed(2)} disabled /></div></div>
          <div className="flex justify-between items-center invoice-summary">{quoteItemDiscountTotal > 0 && <div><span className="text-muted">Item discounts: </span><strong className="text-danger">-₹{quoteItemDiscountTotal.toFixed(2)}</strong></div>}<div><span className="text-muted">Subtotal: </span><strong>₹{quoteSubtotal.toLocaleString()}</strong></div>{quoteDiscountAmount > 0 && <div><span className="text-muted">Whole-quote discount: </span><strong className="text-danger">-₹{quoteDiscountAmount.toFixed(2)}</strong></div>}<div><span className="text-muted">Taxable value: </span><strong>₹{quoteNetTaxableValue.toFixed(2)}</strong></div><div><span className="text-muted">GST ({quoteGstPercent}%){quoteGstInclusive ? ' incl.' : ''}: </span><strong>₹{quoteGstAmount.toFixed(2)}</strong></div><div><strong>Quote Total: </strong><span className="invoice-total">₹{quoteTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div></div>
        </div>
        <div className="modal-footer">
          <div className="text-muted text-sm" style={{ marginRight: 'auto', maxWidth: '360px' }}>
            {editingQuoteDraft
              ? <>This is still a draft. <strong>Confirm Quotation</strong> finishes it, ready to print or turn into an invoice. <strong>Save &amp; Keep as Draft</strong> leaves it parked.</>
              : editingQuotation
                ? 'This quotation is already confirmed. Saving your changes keeps it that way.'
                : 'Save as Draft parks it to finish later — a draft cannot be turned into an invoice until you confirm it.'}
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => { setShowQuotationModal(false); setEditingQuotation(null); }}>Cancel</button>
          {/* Offered on a new quotation and on a draft being edited, so a quote can be worked on
              over several sittings. Not offered on a confirmed one: it is finished and ready to
              convert, and quietly parking it again would hide that. */}
          {(!editingQuotation || editingQuoteDraft) && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!quoteTotal || savingQuotation || savingQuoteDraft}
              onClick={() => void persistQuotation(DRAFT_STATUS)}
            >
              {savingQuoteDraft ? 'Saving…' : editingQuoteDraft ? 'Save & Keep as Draft' : 'Save as Draft'}
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={!quoteTotal || savingQuotation || savingQuoteDraft}>
            {savingQuotation ? 'Saving…' : editingQuotation ? (editingQuoteDraft ? 'Confirm Quotation' : 'Save Changes') : 'Save Quotation'}
          </button>
        </div>
      </form></div></div>}

      {viewingInvoice && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '560px' }} role="dialog" aria-modal="true" aria-labelledby="view-invoice-title">
        <div className="modal-header"><h3 id="view-invoice-title" className="modal-title">{viewingInvoice.id}</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setViewingInvoice(null)}>✕</button></div>
        <div className="modal-body flex flex-col gap-4">
          <div className="flex justify-between"><div><small className="text-muted">Customer</small><div style={{ fontWeight: 600 }}>{viewingInvoice.customer}</div></div><div><small className="text-muted">Date</small><div style={{ fontWeight: 600 }}>{viewingInvoice.date}</div></div></div>
          <div className="table-wrap"><table className="erp-table">
            <thead><tr><th>Product</th><th className="text-right">Qty</th><th className="text-right">Unit Price</th><th className="text-right">Line Total</th></tr></thead>
            <tbody>
              {invoiceItems.filter((item) => item.invoice_id === viewingInvoice.id).map((item) => (
                <tr key={item.id}><td>{item.name}</td><td className="text-right">{item.qty}</td><td className="text-right">₹{money(Number(item.unit_price))}</td><td className="text-right">₹{money(Number(item.line_total))}</td></tr>
              ))}
              {invoiceItems.filter((item) => item.invoice_id === viewingInvoice.id).length === 0 && (
                <tr><td colSpan={4}><p className="text-muted text-sm" style={{ padding: '12px 0' }}>Line items weren&apos;t recorded for this older invoice — only the total is available.</p></td></tr>
              )}
            </tbody>
          </table></div>
          <div className="report-summary">
            {Number(viewingInvoice.discount_amount) > 0 && <div className="report-line"><span>Discount ({Number(viewingInvoice.discount_percent).toFixed(0)}%)</span><span className="text-danger">-₹{money(Number(viewingInvoice.discount_amount))}</span></div>}
            <div className="report-line report-strong"><span>Total</span><strong>₹{money(Number(viewingInvoice.total))}</strong></div>
            <div className="report-line"><span>Paid</span><strong className="text-success">₹{money(Number(viewingInvoice.paid))}</strong></div>
            {wasSettledShort(viewingInvoice) && (
              <div className="report-line"><span>Settled off</span><strong className="text-muted">₹{money(invoiceWrittenOff(viewingInvoice))}</strong></div>
            )}
            <div className="report-line"><span>Balance</span><strong className={invoiceBalanceDue(viewingInvoice) > 0 ? 'text-danger' : 'text-muted'}>₹{money(invoiceBalanceDue(viewingInvoice))}</strong></div>
          </div>
        </div>
        <div className="modal-footer">
          {invoiceBalanceDue(viewingInvoice) > 0 && viewingInvoice.status !== DRAFT_STATUS && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginRight: 'auto' }}
              title={`Take what the customer is paying and close the remaining ₹${money(invoiceBalanceDue(viewingInvoice))}`}
              onClick={() => { const invoice = viewingInvoice; setViewingInvoice(null); openSettleShort(invoice); }}
            ><HandCoins size={14} /> Settle &amp; close</button>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => window.open(`/sales/invoice/${viewingInvoice.id}`, '_blank')}><Printer size={14} /> Print</button>
          <button type="button" className="btn btn-primary" onClick={() => setViewingInvoice(null)}>Close</button>
        </div>
      </div></div>}

      {settlingInvoice && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '480px' }} role="dialog" aria-modal="true" aria-labelledby="settle-short-title">
        <div className="modal-header">
          <div>
            <h3 id="settle-short-title" className="modal-title flex items-center gap-2"><HandCoins size={16} /> Settle &amp; close</h3>
            <p className="text-muted text-sm">Enter what the customer paid. Anything left stops showing as owed.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Close" disabled={savingSettlement} onClick={() => setSettlingInvoice(null)}>✕</button>
        </div>
        <div className="modal-body flex flex-col gap-3">
          {settleError && <div className="alert alert-danger" role="alert">{settleError}</div>}
          <div className="report-summary">
            <div className="report-line"><span>{settlingInvoice.id} — {settlingInvoice.customer}</span><span className="text-muted">{settlingInvoice.date}</span></div>
            <div className="report-line"><span>Invoice total</span><strong>₹{money(Number(settlingInvoice.total))}</strong></div>
            <div className="report-line"><span>Received earlier</span><strong>₹{money(Number(settlingInvoice.paid))}</strong></div>
            <div className="report-line report-strong"><span>Still open</span><strong>₹{money(settleDue)}</strong></div>
          </div>

          {/* The one number the owner is asked for is the one he is actually holding. Everything
              else on this dialog is worked out from it. */}
          <div className="form-group">
            <label className="form-label" htmlFor="settle-received">How much is {settlingInvoice.customer} paying now? (₹)</label>
            <input id="settle-received" type="number" min="0" step="0.01" max={settleDue} className="form-input"
              value={settleReceived} disabled={savingSettlement} onChange={(event) => setSettleReceived(Number(event.target.value))} autoFocus />
            <p className="text-muted" style={{ fontSize: '12px' }}>Leave it at 0 if they have already paid everything they are going to.</p>
          </div>

          {/* The result, stated as what the sale earned. The amount being let go is still here —
              agreeing to it is the whole point of the dialog, and hiding it would be hiding a real
              decision — but it is a quiet line under the outcome, never the headline and never the
              number being typed in. */}
          <div className="report-summary">
            {settleOutcome ? <>
              <div className="report-line report-strong">
                <span>{settleOutcome.profit >= 0 ? 'You made on this sale' : 'You lost on this sale'}</span>
                <strong className={settleOutcome.profit >= 0 ? 'text-success' : 'text-danger'}>₹{money(Math.abs(settleOutcome.profit))}</strong>
              </div>
              <div className="report-line"><span>Money received in total</span><span>₹{money(settleOutcome.received)}</span></div>
              <div className="report-line"><span>What these goods cost you</span><span className="text-muted">₹{money(settleOutcome.cost)}</span></div>
            </> : (
              <div className="report-line report-strong">
                <span>Money received on this sale</span>
                <strong className="text-success">₹{money(settleTotalReceived)}</strong>
              </div>
            )}
            {settleClosing > 0 && <div className="report-line"><span>Settled off, so nobody chases it</span><span className="text-muted">₹{money(settleClosing)}</span></div>}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="settle-reason">Note (optional)</label>
            <input id="settle-reason" type="text" className="form-input" placeholder="e.g. rounded off in cash, agreed discount for late delivery"
              value={settleReason} disabled={savingSettlement} onChange={(event) => setSettleReason(event.target.value)} />
          </div>
          <p className="text-muted" style={{ fontSize: '12px' }}>
            The invoice keeps the total it was issued for, and only money that actually arrived is
            counted as received — so this closes the balance without inflating your takings.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" disabled={savingSettlement} onClick={() => setSettlingInvoice(null)}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={savingSettlement || settleDue <= 0} onClick={confirmSettleShort}>{savingSettlement ? 'Recording…' : 'Record Settlement'}</button>
        </div>
      </div></div>}

      {creditToUndo && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '480px' }} role="dialog" aria-modal="true" aria-labelledby="undo-credit-title">
        <div className="modal-header"><h3 id="undo-credit-title" className="modal-title">Undo {creditToUndo.id}?</h3></div>
        <div className="modal-body flex flex-col gap-3">
          {creditError && <div className="alert alert-danger" role="alert">{creditError}</div>}
          <p>
            This takes the returned goods back off the shelf and removes the credit note. Use it when the
            same return was recorded more than once, or recorded by mistake — not when goods genuinely came back.
          </p>
          <div className="report-summary">
            <div className="report-line"><span>Against</span><strong>{creditToUndo.invoice_id}</strong></div>
            <div className="report-line"><span>Credited</span><strong>₹{paise(Number(creditToUndo.credit_total))}</strong></div>
            {creditToUndo.reason && <div className="report-line"><span>Reason given</span><span className="text-muted">{creditToUndo.reason}</span></div>}
          </div>
          <p className="text-muted" style={{ fontSize: '12px' }}>
            Whether {creditToUndo.invoice_id} goes back to its original total depends on whether it has been
            edited since this credit note was written. An edit rebuilds every line, which already removed this
            credit from the invoice — in that case only the stock is corrected, and you will be told so.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" disabled={undoingCredit} onClick={() => setCreditToUndo(null)}>Cancel</button>
          <button type="button" className="btn btn-danger" disabled={undoingCredit} onClick={confirmUndoCredit}>{undoingCredit ? 'Undoing…' : 'Undo Credit Note'}</button>
        </div>
      </div></div>}

      {deleteCandidate && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '440px' }} role="dialog" aria-modal="true" aria-labelledby="delete-invoice-title">
        <div className="modal-header"><h3 id="delete-invoice-title" className="modal-title">Delete invoice?</h3></div>
        <div className="modal-body flex flex-col gap-3">
          {deleteError && <div className="alert alert-danger" role="alert">{deleteError}</div>}
          <p>This will delete <strong>{deleteCandidate.id}</strong> and add its items back to stock{customers.some((c) => c.name === deleteCandidate.customer) ? ` and reduce ${deleteCandidate.customer}'s balance by the outstanding ₹${invoiceBalanceDue(deleteCandidate).toLocaleString()}` : ''}.</p>
        </div>
        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setDeleteCandidate(null)} disabled={deletingInvoice}>Cancel</button><button className="btn btn-danger" onClick={confirmDeleteInvoice} disabled={deletingInvoice}>{deletingInvoice ? 'Deleting…' : 'Delete Invoice'}</button></div>
      </div></div>}

      {returnCandidate && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '760px' }} role="dialog" aria-modal="true" aria-labelledby="sales-return-title">
        <div className="modal-header"><div><h3 id="sales-return-title" className="modal-title">Return items from {returnCandidate.id}</h3><p className="text-muted text-sm" style={{ marginTop: '4px' }}>Create a partial return and credit note. You can only return quantities still available.</p></div><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" disabled={savingReturn} onClick={() => setReturnCandidate(null)}>✕</button></div>
        <div className="modal-body flex flex-col gap-4">
          {returnError && <div className="alert alert-danger" role="alert">{returnError}</div>}
          <div className="form-grid-2">
            <div><small className="text-muted">Customer</small><div style={{ fontWeight: 600 }}>{returnCandidate.customer}</div></div>
            <div><small className="text-muted">Original invoice total</small><div style={{ fontWeight: 600 }}>₹{Number(returnCandidate.total).toLocaleString()}</div></div>
          </div>
          <div className="table-wrap"><table className="erp-table">
            <thead><tr><th>Item</th><th className="text-right">Sold</th><th className="text-right">Previously returned</th><th className="text-right">Available</th><th className="text-right">Return now</th><th>Condition</th></tr></thead>
            <tbody>{returnableItems.map((item) => <tr key={item.invoice_item_id}>
              <td><strong>{item.name}</strong><div className="text-muted text-sm">{item.part_number} · ₹{returnNetRate(item).toLocaleString(undefined, { maximumFractionDigits: 2 })} each{Math.abs(returnNetRate(item) - Number(item.unit_price)) > 0.005 ? ` (discounted from ₹${Number(item.unit_price).toLocaleString()})` : ''}</div></td>
              <td className="text-right">{Number(item.sold_qty)}</td>
              <td className="text-right">{Number(item.returned_qty)}</td>
              <td className="text-right" style={{ fontWeight: 700 }}>{Number(item.returnable_qty)}</td>
              <td className="text-right"><input aria-label={`Return quantity for ${item.name}`} type="number" min="0" max={item.returnable_qty} step="1" className="form-input" style={{ width: '88px', marginLeft: 'auto' }} value={returnQuantities[item.invoice_item_id] ?? 0} disabled={savingReturn} onChange={(event) => updateReturnQuantity(item, event.target.value)} /></td>
              {/* Only offered once something is actually coming back on this line — an empty row
                  has no condition to record. Damaged still credits the customer in full; it only
                  stops the goods going back on the shelf to be sold to somebody else. */}
              <td>
                <select
                  aria-label={`Condition of returned ${item.name}`}
                  className="form-input form-select"
                  style={{ width: '150px' }}
                  value={returnConditions[item.invoice_item_id] ?? 'resellable'}
                  disabled={savingReturn || !((returnQuantities[item.invoice_item_id] ?? 0) > 0)}
                  onChange={(event) => setReturnConditions((current) => ({
                    ...current,
                    [item.invoice_item_id]: event.target.value === 'damaged' ? 'damaged' : 'resellable',
                  }))}
                >
                  <option value="resellable">Can be sold again</option>
                  <option value="damaged">Damaged — do not restock</option>
                </select>
              </td>
            </tr>)}</tbody>
          </table></div>
          <div className="form-group"><label className="form-label" htmlFor="sales-return-reason">Reason for return</label><input id="sales-return-reason" className="form-input" maxLength={500} placeholder="For example: damaged, wrong part, customer changed mind" value={returnReason} disabled={savingReturn} onChange={(event) => setReturnReason(event.target.value)} /></div>
          <div className="alert alert-warning" role="status">The selected items were charged ₹{returnItemValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}, after any discount on those lines. The credit note then applies this invoice&apos;s own discount and GST exactly as they were charged{returnCandidate.gst_mode === 'inclusive' ? ', with GST taken out of that amount rather than added to it' : ''}. Stock and customer balance will change only after confirmation.</div>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" disabled={savingReturn} onClick={() => setReturnCandidate(null)}>Cancel</button><button type="button" className="btn btn-danger" disabled={savingReturn || selectedReturnItems.length === 0 || !returnReason.trim()} onClick={saveSalesReturn}>{savingReturn ? 'Creating credit note…' : 'Confirm Return & Credit'}</button></div>
      </div></div>}

      {showInvoiceModal && (
        <InvoiceFormModal
          lines={lines} setLines={setLines} updateLine={updateLine}
          invoiceDate={invoiceDate} setInvoiceDate={setInvoiceDate}
          customer={customer} setCustomer={setCustomer}
          paymentStatus={paymentStatus} setPaymentStatus={setPaymentStatus}
          amountPaid={amountPaid} setAmountPaid={setAmountPaid}
          discountPercent={discountPercent} setDiscountPercent={setDiscountPercent}
          gstPercent={gstPercent} setGstPercent={setGstPercent}
          gstInclusive={gstInclusive} setGstInclusive={setGstInclusive}
          totals={invoiceMoney} paidAmount={paidAmount} newOutstanding={newOutstanding}
          editingInvoice={editingInvoice} setEditingInvoice={setEditingInvoice} editingDraft={editingDraft}
          invoiceError={invoiceError} savingInvoice={savingInvoice} savingDraft={savingDraft}
          selectedCustomer={selectedCustomer} creditSaleNeedsCustomer={creditSaleNeedsCustomer}
          partOptions={partOptions} customers={customers} placeOfSupply={placeOfSupply} lastSold={lastSold}
          halfGstPercent={halfGstPercent} supplyKind={supplyKind}
          setShowInvoiceModal={setShowInvoiceModal} setShowAddCustomer={setShowAddCustomer}
          saveInvoice={saveInvoice} saveDraftInvoice={saveDraftInvoice}
        />
      )}

      {showAddCustomer && (
        <AddCustomerModal
          onClose={() => setShowAddCustomer(false)}
          onSave={createCustomer}
          onCreated={(newCustomer) => { setCustomer(newCustomer.name); setShowAddCustomer(false); }}
        />
      )}

      {showPaymentModal && (
        <ReceivePaymentModal
          customerId={paymentModalCustomerId}
          onClose={() => setShowPaymentModal(false)}
          onRecorded={(result) => {
            setShowPaymentModal(false);
            setFeedback(`₹${result.appliedTotal.toLocaleString('en-IN')} received from ${result.customerName} (${result.paymentId}).`);
          }}
        />
      )}

      {deletePaymentCandidate && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '440px' }} role="dialog" aria-modal="true" aria-labelledby="delete-payment-title">
        <div className="modal-header"><h3 id="delete-payment-title" className="modal-title">Reverse this payment?</h3></div>
        <div className="modal-body flex flex-col gap-3">
          {deletePaymentError && <div className="alert alert-danger" role="alert">{deletePaymentError}</div>}
          <p>This will put every invoice <strong>{deletePaymentCandidate.id}</strong> was applied to back to its balance before this payment, and add ₹{Number(deletePaymentCandidate.amount).toLocaleString()} back to {deletePaymentCandidate.customer}&apos;s outstanding balance. Use this for a payment entered wrong — not for a genuine refund.</p>
        </div>
        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setDeletePaymentCandidate(null)} disabled={deletingPayment}>Cancel</button><button className="btn btn-danger" onClick={confirmDeletePayment} disabled={deletingPayment}>{deletingPayment ? 'Reversing…' : 'Reverse Payment'}</button></div>
      </div></div>}
    </div>
  );
}
