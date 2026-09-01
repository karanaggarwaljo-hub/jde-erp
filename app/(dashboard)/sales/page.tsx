'use client';

import { FormEvent, useState } from 'react';
import {
  Plus,
  Minus,
  X,
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
  XCircle,
  MapPin,
  Undo2,
  Wallet,
  History,
} from 'lucide-react';
import { saveSalesInvoice, deleteSalesInvoice, deleteCustomerPayment } from '@/lib/client-sales';
import { createSalesReturn, getReturnableInvoiceItems, type ReturnableInvoiceItem } from '@/lib/client-sales-returns';
import { convertQuotation, getQuotation, saveQuotation, type QuotationDetail } from '@/lib/client-quotations';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { buildCustomerLedger } from '@/lib/customer-ledger';
import AddCustomerModal from '@/components/AddCustomerModal';
import ReceivePaymentModal from '@/components/ReceivePaymentModal';

type SalesTab = 'invoices' | 'quotations' | 'ledger';
type PaymentStatus = 'paid' | 'partial' | 'unpaid';
type PaymentFilter = 'all' | 'paid' | 'partial' | 'unpaid' | 'drafts';
/** `discount` is a percentage off THIS line only, kept separate from the invoice-wide discount
 *  below. Optional because quotations reuse this shape and do not offer one — absent means none. */
type InvoiceLine = { part: string; qty: number; price: number; discount?: number };

type Product = { id: string; company_id: string; part_number: string; name: string; brand: string; hsn_code: string; category: string; sale_price: number; current_stock: number };
type Customer = { id: string; company_id: string; name: string; phone: string; email: string; gstin: string; address: string; type: string; balance: number };
// gst_percent / gst_amount are on the invoice table but were never filled in by the atomic save,
// so they are absent on every invoice written before this screen started recording them.
type Invoice = { id: string; company_id: string; customer: string; date: string; items: number; total: number; paid: number; status: string; mode: string; discount_percent: number; discount_amount: number; gst_percent?: number | null; gst_amount?: number | null; gst_mode?: string | null };
type Quotation = { id: string; company_id: string; customer: string; date: string; validity: string; total: number; status: string };
type InvoiceItem = { id: string; invoice_id: string; product_id: string | null; part_number: string; name: string; qty: number; unit_price: number; line_total: number; discount_percent?: number; discount_amount?: number };
type Payment = { id: string; company_id: string; customer_id: string; customer: string; date: string; amount: number; note: string; created_at: string };
type PaymentAllocation = { id: string; payment_id: string; company_id: string; invoice_id: string; amount: number; created_at: string };

// Everything the printable document needs, captured at the moment it is opened. A snapshot rather
// than a live lookup, so the document keeps showing the invoice it was opened for even after the
// dialog behind it has been reset for the next sale.
// The status the atomic save is given for a sale the owner wants to park and finish later. It
// reserves stock like any other invoice, but nothing is billed and nothing is owed yet.
const DRAFT_STATUS = 'draft';

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

// How many invoice rows are painted at once. Every invoice is already in memory — this changes
// nothing about what is loaded, only how much of it is rendered, so paging costs no extra request.
const PAGE_SIZE = 25;

// Reference data, not business data: the statutory GST state codes, which are the first two
// digits of every GSTIN. Used only to name the place of supply on a tax invoice — nothing here
// is a figure, a price or a company-specific value.
const GST_STATE_NAMES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman and Diu',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
  '99': 'Centre Jurisdiction',
};

// Indian digit grouping, matching Inventory and Customers. Display only — nothing rounded here
// is ever written back.
const money = (value: number) => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const paise = (value: number) => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
const WALK_IN_CUSTOMER = 'Walk-in Customer';

export default function SalesPage() {
  const { rows: products, reload: reloadProducts, activeCompany } = useCompanyTable<Product>('products');
  const { rows: customers, create: createCustomer, reload: reloadCustomers } = useCompanyTable<Customer>('customers');
  const { rows: invoices, loading: invoicesLoading, reload: reloadInvoices, update: updateInvoiceRow } = useCompanyTable<Invoice>('invoices');
  const { rows: quotations, loading: quotationsLoading, reload: reloadQuotations } = useCompanyTable<Quotation>('quotations');
  const { rows: invoiceItems, reload: reloadInvoiceItems } = useCompanyTable<InvoiceItem>('invoice_items');
  const { rows: payments, reload: reloadPayments } = useCompanyTable<Payment>('payments_received');
  const { rows: paymentAllocations } = useCompanyTable<PaymentAllocation>('payment_allocations');

  // `value`, `price` and `category` are untouched — the save path matches lines on `value` and
  // fills the rate from `price`. The rest are extra fields off the same already-loaded product
  // row, used only to describe the line in the dialog.
  const partOptions = products.map((product) => ({
    value: `${product.part_number} - ${product.name}`,
    price: product.sale_price,
    category: product.category,
    partNumber: product.part_number,
    brand: product.brand,
    stock: product.current_stock,
    hsn: product.hsn_code,
  }));

  const [activeTab, setActiveTab] = useState<SalesTab>('invoices');
  const [search, setSearch] = useState('');
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Invoice | null>(null);
  const [returnCandidate, setReturnCandidate] = useState<Invoice | null>(null);
  const [returnableItems, setReturnableItems] = useState<ReturnableInvoiceItem[]>([]);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [returnReason, setReturnReason] = useState('');
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
  const [loadingQuotation, setLoadingQuotation] = useState(false);
  const [convertingQuotationId, setConvertingQuotationId] = useState<string | null>(null);
  const [quoteCustomer, setQuoteCustomer] = useState('');
  const [quoteDate, setQuoteDate] = useState(todayIso());
  const [quoteValidity, setQuoteValidity] = useState(todayIso());
  const [quoteLines, setQuoteLines] = useState<InvoiceLine[]>([]);
  const [quoteDiscountPercent, setQuoteDiscountPercent] = useState(0);
  const [quoteGstPercent, setQuoteGstPercent] = useState(18);

  // Two discounts now exist and they stack in a fixed order: each line is discounted on its own
  // first, and the invoice-wide discount then applies to whatever that leaves. Doing it the other
  // way round would change the tax base, so the order is not cosmetic.
  const lineGross = (line: InvoiceLine) => Number(line.qty) * Number(line.price);
  const lineDiscountPercent = (line: InvoiceLine) => Math.min(100, Math.max(0, Number(line.discount) || 0));
  const lineNet = (line: InvoiceLine) => lineGross(line) * (1 - lineDiscountPercent(line) / 100);

  const grossSubtotal = lines.reduce((sum, line) => sum + lineGross(line), 0);
  const subtotal = lines.reduce((sum, line) => sum + lineNet(line), 0);
  const itemDiscountTotal = grossSubtotal - subtotal;
  const discountAmount = subtotal * (discountPercent / 100);
  const taxableAmount = subtotal - discountAmount;
  // `taxableAmount` above is the amount left after both discounts. What it MEANS depends on the
  // mode: priced exclusive it is the taxable value and tax is added to it; priced inclusive it is
  // already the amount payable and the tax is inside it. Both are computed from the same figure,
  // so switching the toggle never re-reads or rewrites anything the owner typed.
  const gstAmount = gstInclusive
    ? taxableAmount * (gstPercent / (100 + gstPercent))
    : taxableAmount * (gstPercent / 100);
  // The GST taxable value — what the tax is actually charged on — in both modes.
  const netTaxableValue = gstInclusive ? taxableAmount - gstAmount : taxableAmount;
  const total = gstInclusive ? taxableAmount : taxableAmount + gstAmount;
  const paidAmount = paymentStatus === 'paid' ? total : paymentStatus === 'partial' ? Math.min(Math.max(amountPaid, 0), total) : 0;
  const quoteSubtotal = quoteLines.reduce((sum, line) => sum + line.qty * line.price, 0);
  const quoteDiscountAmount = quoteSubtotal * (quoteDiscountPercent / 100);
  const quoteTaxableAmount = quoteSubtotal - quoteDiscountAmount;
  const quoteGstAmount = quoteTaxableAmount * (quoteGstPercent / 100);
  const quoteTotal = quoteTaxableAmount + quoteGstAmount;

  const selectedCustomer = customers.find((c) => c.name === customer);
  const customerLabel = customer.trim() || WALK_IN_CUSTOMER;
  // A parked draft opens in this dialog exactly like an edit, with one difference that matters for
  // money: parking it added nothing to the customer's balance, so confirming it has to start from
  // zero outstanding. Starting from its total would reverse a debt that was never recorded.
  const editingDraft = Boolean(editingInvoice && editingInvoice.status === DRAFT_STATUS);
  const editingOldOutstanding = editingInvoice && !editingDraft ? Number(editingInvoice.total) - Number(editingInvoice.paid) : 0;
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
  const outstandingDue = liveInvoices.reduce((t, inv) => t + Math.max(0, Number(inv.total) - Number(inv.paid)), 0);
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
  const balanceOf = (invoice: Invoice) => Number(invoice.total) - Number(invoice.paid);
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
    .map((item) => ({ invoice_item_id: item.invoice_item_id, qty: Math.min(item.returnable_qty, Math.max(0, Number(returnQuantities[item.invoice_item_id] ?? 0))) }))
    .filter((item) => Number.isInteger(item.qty) && item.qty > 0);
  const returnItemValue = returnableItems.reduce((sum, item) => sum + (returnQuantities[item.invoice_item_id] ?? 0) * Number(item.unit_price), 0);

  const openInvoice = (presetCustomer?: string) => {
    setEditingInvoice(null);
    setCustomer(presetCustomer ?? '');
    setLines(partOptions.length > 0 ? [{ part: '', qty: 1, price: 0, discount: 0 }] : []);
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
        line_total: line.qty * line.price,
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
    setQuoteLines(partOptions.length > 0 ? [{ part: '', qty: 1, price: 0, discount: 0 }] : []);
    setQuoteDiscountPercent(0);
    setQuoteGstPercent(18);
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
      setQuoteLines(detail.items.map((item) => ({ part: `${item.part_number} - ${item.name}`, qty: Number(item.qty), price: Number(item.unit_price) })));
      setQuoteDiscountPercent(Number(detail.discount_percent ?? 0));
      setQuoteGstPercent(Number(detail.gst_percent ?? 18));
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

  const saveQuote = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeCompany) return;
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

    setSavingQuotation(true);
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
        total: quoteTotal,
      });
      await reloadQuotations();
      setShowQuotationModal(false);
      setEditingQuotation(null);
      setActiveTab('quotations');
      setFeedback(`${quote.id} ${editingQuotation ? 'updated' : 'saved'} — inventory is unchanged until conversion.`);
    } catch (error) {
      setQuotationError(error instanceof Error ? error.message : 'Failed to save quotation.');
    } finally {
      setSavingQuotation(false);
    }
  };

  const convertQuote = async (quote: Quotation) => {
    if (!activeCompany || quote.status === 'converted') return;
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

  // gst_percent and gst_amount are display-only columns: they exist so a saved invoice can print
  // its correct tax split later. The invoice itself is already saved correctly by the atomic call
  // that runs before this, so a failure here is logged and ignored — it must never turn a
  // completed sale into an error on screen.
  const rememberGstSplit = async (invoiceId: string, percent: number, amount: number) => {
    try {
      await updateInvoiceRow(invoiceId, {
        gst_percent: percent,
        gst_amount: amount,
        gst_mode: gstInclusive ? 'inclusive' : 'exclusive',
      });
    } catch (error) {
      console.error(`Could not record the GST split on ${invoiceId} — the invoice itself is saved.`, error);
    }
  };

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
      });

      const draftId = String(invoice.id);
      await rememberGstSplit(draftId, gstPercent, gstAmount);
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
        });

        await rememberGstSplit(editingInvoice.id, gstPercent, gstAmount);
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
      });

      const createdId = String(invoice.id);
      await rememberGstSplit(createdId, gstPercent, gstAmount);
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
    if (!window.confirm(`Create a credit note for ${selectedReturnItems.reduce((sum, item) => sum + item.qty, 0)} returned unit(s)? Stock and the customer balance will be updated together.`)) return;

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
      setFeedback(`${result.id} created for ${returnCandidate.id} — ₹${Number(result.credit_total).toLocaleString()} credited.`);
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
                  const balance = Number(invoice.total) - Number(invoice.paid);
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
                      </div>
                    </td>
                    <td>
                      {balance <= 0
                        ? <span className="badge badge-success"><CheckCircle2 size={12} />Paid</span>
                        : Number(invoice.paid) > 0
                          ? <span className="badge badge-warning"><AlertTriangle size={12} />Due ₹{money(balance)}</span>
                          : <span className="badge badge-danger"><XCircle size={12} />Unpaid</span>}
                    </td>
                    <td className="text-center"><div className="flex justify-between gap-1 items-center">
                      <button className="btn btn-ghost btn-sm" aria-label={`View ${invoice.id}`} title="View invoice" onClick={() => setViewingInvoice(invoice)}><Eye size={14} /></button>
                      <button
                        className="btn btn-ghost btn-sm"
                        aria-label={`Edit ${invoice.id}`}
                        title={items.length > 0 ? 'Edit invoice' : "Edit unavailable — this invoice predates line-item tracking"}
                        disabled={items.length === 0}
                        style={items.length === 0 ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                        onClick={() => items.length > 0 && openEditInvoice(invoice)}
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
                      <button className="btn btn-ghost btn-sm" aria-label={`Delete ${invoice.id}`} title="Delete invoice" style={{ color: 'var(--color-danger)' }} onClick={() => setDeleteCandidate(invoice)}><Trash2 size={14} /></button>
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
                <td><span className={`badge ${quote.status === 'converted' || quote.status === 'accepted' ? 'badge-success' : quote.validity < todayIso() ? 'badge-warning' : 'badge-info'}`}>{quote.status === 'draft' && quote.validity < todayIso() ? 'EXPIRED' : quote.status.toUpperCase()}</span></td>
                <td className="text-center"><div className="flex justify-between gap-1 items-center">
                  <button className="btn btn-ghost btn-sm" title="View quotation" aria-label={`View ${quote.id}`} disabled={loadingQuotation} onClick={() => void loadQuotationFor(quote, 'view')}><Eye size={14} /></button>
                  <button className="btn btn-ghost btn-sm" title="Edit quotation" aria-label={`Edit ${quote.id}`} disabled={loadingQuotation || quote.status === 'converted'} onClick={() => void loadQuotationFor(quote, 'edit')}><Pencil size={14} /></button>
                  <button className="btn btn-ghost btn-sm" title="Print quotation" aria-label={`Print ${quote.id}`} onClick={() => window.open(`/sales/quotation/${quote.id}`, '_blank')}><Printer size={14} /></button>
                  <button className="btn btn-secondary btn-sm" disabled={convertingQuotationId === quote.id || quote.status === 'converted'} onClick={() => void convertQuote(quote)}>{convertingQuotationId === quote.id ? 'Converting…' : quote.status === 'converted' ? 'Converted' : 'Convert'}</button>
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
          <div className="form-grid-2"><div><small className="text-muted">Customer</small><div style={{ fontWeight: 600 }}>{viewingQuotation.customer}</div></div><div><small className="text-muted">Quote date</small><div style={{ fontWeight: 600 }}>{viewingQuotation.date}</div></div><div><small className="text-muted">Valid until</small><div style={{ fontWeight: 600 }}>{viewingQuotation.validity}</div></div><div><small className="text-muted">Status</small><div style={{ fontWeight: 600 }}>{viewingQuotation.status.toUpperCase()}</div></div></div>
          <div className="table-wrap"><table className="erp-table"><thead><tr><th>Part</th><th className="text-right">Qty</th><th className="text-right">Unit Price</th><th className="text-right">Line Total</th></tr></thead><tbody>{viewingQuotation.items.map((item, index) => <tr key={`${item.part_number}-${index}`}><td><div style={{ fontWeight: 600 }}>{item.name}</div><small className="text-muted">{item.part_number}</small></td><td className="text-right">{item.qty}</td><td className="text-right">₹{Number(item.unit_price).toLocaleString()}</td><td className="text-right">₹{Number(item.line_total).toLocaleString()}</td></tr>)}</tbody></table></div>
          <div className="report-summary"><div className="report-line"><span>Subtotal</span><span>₹{Number(viewingQuotation.subtotal ?? viewingQuotation.total).toLocaleString()}</span></div>{Number(viewingQuotation.discount_amount) > 0 && <div className="report-line"><span>Discount ({Number(viewingQuotation.discount_percent).toFixed(1)}%)</span><span className="text-danger">-₹{Number(viewingQuotation.discount_amount).toLocaleString()}</span></div>}<div className="report-line"><span>GST ({Number(viewingQuotation.gst_percent ?? 0).toFixed(1)}%)</span><span>₹{Number(viewingQuotation.gst_amount ?? 0).toLocaleString()}</span></div><div className="report-line report-strong"><span>Quotation Total</span><strong>₹{Number(viewingQuotation.total).toLocaleString()}</strong></div></div>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => window.open(`/sales/quotation/${viewingQuotation.id}`, '_blank')}><Printer size={14} /> Print</button><button type="button" className="btn btn-primary" onClick={() => setViewingQuotation(null)}>Close</button></div>
      </div></div>}

      {showQuotationModal && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '880px' }} role="dialog" aria-modal="true" aria-labelledby="quotation-modal-title"><form onSubmit={saveQuote}>
        <div className="modal-header"><div><h3 id="quotation-modal-title" className="modal-title">{editingQuotation ? `Edit ${editingQuotation.id}` : 'Create Quotation'}</h3><p className="text-muted text-sm">Saving a quotation never changes inventory or customer balances.</p></div><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => { setShowQuotationModal(false); setEditingQuotation(null); }}>✕</button></div>
        <div className="modal-body flex flex-col gap-4">
          {quotationError && <div className="alert alert-danger" role="alert">{quotationError}</div>}
          <div className="form-grid-2"><div className="form-group"><label className="form-label">Customer</label><select required className="form-input form-select" value={quoteCustomer} onChange={(event) => setQuoteCustomer(event.target.value)}><option value="">Select customer…</option>{customers.map((entry) => <option key={entry.id} value={entry.name}>{entry.name}</option>)}</select></div><div className="form-group"><label className="form-label">Quote Date</label><input required type="date" className="form-input" value={quoteDate} onChange={(event) => setQuoteDate(event.target.value)} /></div><div className="form-group"><label className="form-label">Valid Until</label><input required type="date" min={quoteDate} className="form-input" value={quoteValidity} onChange={(event) => setQuoteValidity(event.target.value)} /></div></div>
          <div className="card card-sm bg-surface"><h4 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>Quoted Parts</h4>{partOptions.length === 0 && <p className="text-muted text-sm">Add parts in Inventory before creating a quotation.</p>}<datalist id="quotation-part-options">{partOptions.map((part) => <option key={part.value} value={part.value} />)}</datalist>{quoteLines.map((line, index) => { const matched = partOptions.find((part) => part.value === line.part); return <div key={index} className="form-grid-4 mb-2"><div className="form-group"><label className="form-label">Part</label><input list="quotation-part-options" className="form-input" placeholder="Type to search a part…" value={line.part} onChange={(event) => { const selected = partOptions.find((part) => part.value === event.target.value); updateQuoteLine(index, { part: event.target.value, price: selected?.price ?? line.price }); }} />{line.part.trim() && !matched && <small className="text-danger">No matching part in Inventory</small>}</div><div className="form-group"><label className="form-label">Category</label><input className="form-input" value={matched?.category ?? '—'} disabled /></div><div className="form-group"><label className="form-label">Qty</label><input required type="number" min="1" className="form-input" value={line.qty} onChange={(event) => updateQuoteLine(index, { qty: Number(event.target.value) })} /></div><div className="form-group"><label className="form-label">Unit Price (₹)</label><input required type="number" min="0" className="form-input" value={line.price} onChange={(event) => updateQuoteLine(index, { price: Number(event.target.value) })} /></div></div>; })}{partOptions.length > 0 && <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => setQuoteLines((current) => [...current, { part: '', qty: 1, price: 0, discount: 0 }])}>+ Add Item Row</button>}</div>
          <div className="form-grid-2"><div className="form-group"><label className="form-label">Discount (%)</label><input type="number" min="0" max="100" step="0.1" className="form-input" value={quoteDiscountPercent} onChange={(event) => setQuoteDiscountPercent(Math.min(100, Math.max(0, Number(event.target.value))))} /></div><div className="form-group"><label className="form-label">Discount Amount (₹)</label><input className="form-input" value={quoteDiscountAmount.toFixed(2)} disabled /></div><div className="form-group"><label className="form-label">GST Rate (%)</label><input type="number" min="0" max="28" step="0.1" className="form-input" value={quoteGstPercent} onChange={(event) => setQuoteGstPercent(Math.min(28, Math.max(0, Number(event.target.value))))} /></div><div className="form-group"><label className="form-label">GST Amount (₹)</label><input className="form-input" value={quoteGstAmount.toFixed(2)} disabled /></div></div>
          <div className="flex justify-between items-center invoice-summary"><div><span className="text-muted">Subtotal: </span><strong>₹{quoteSubtotal.toLocaleString()}</strong></div>{quoteDiscountAmount > 0 && <div><span className="text-muted">Discount: </span><strong className="text-danger">-₹{quoteDiscountAmount.toFixed(2)}</strong></div>}<div><span className="text-muted">GST ({quoteGstPercent}%): </span><strong>₹{quoteGstAmount.toFixed(2)}</strong></div><div><strong>Quote Total: </strong><span className="invoice-total">₹{quoteTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div></div>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => { setShowQuotationModal(false); setEditingQuotation(null); }}>Cancel</button><button type="submit" className="btn btn-primary" disabled={!quoteTotal || savingQuotation}>{savingQuotation ? 'Saving…' : editingQuotation ? 'Save Changes' : 'Save Quotation'}</button></div>
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
            <div className="report-line"><span>Balance</span><strong className="text-danger">₹{money(Number(viewingInvoice.total) - Number(viewingInvoice.paid))}</strong></div>
          </div>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => window.open(`/sales/invoice/${viewingInvoice.id}`, '_blank')}><Printer size={14} /> Print</button><button type="button" className="btn btn-primary" onClick={() => setViewingInvoice(null)}>Close</button></div>
      </div></div>}

      {deleteCandidate && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '440px' }} role="dialog" aria-modal="true" aria-labelledby="delete-invoice-title">
        <div className="modal-header"><h3 id="delete-invoice-title" className="modal-title">Delete invoice?</h3></div>
        <div className="modal-body flex flex-col gap-3">
          {deleteError && <div className="alert alert-danger" role="alert">{deleteError}</div>}
          <p>This will delete <strong>{deleteCandidate.id}</strong> and add its items back to stock{customers.some((c) => c.name === deleteCandidate.customer) ? ` and reduce ${deleteCandidate.customer}'s balance by the outstanding ₹${(Number(deleteCandidate.total) - Number(deleteCandidate.paid)).toLocaleString()}` : ''}.</p>
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
            <thead><tr><th>Item</th><th className="text-right">Sold</th><th className="text-right">Previously returned</th><th className="text-right">Available</th><th className="text-right">Return now</th></tr></thead>
            <tbody>{returnableItems.map((item) => <tr key={item.invoice_item_id}>
              <td><strong>{item.name}</strong><div className="text-muted text-sm">{item.part_number} · ₹{Number(item.unit_price).toLocaleString()} each</div></td>
              <td className="text-right">{Number(item.sold_qty)}</td>
              <td className="text-right">{Number(item.returned_qty)}</td>
              <td className="text-right" style={{ fontWeight: 700 }}>{Number(item.returnable_qty)}</td>
              <td className="text-right"><input aria-label={`Return quantity for ${item.name}`} type="number" min="0" max={item.returnable_qty} step="1" className="form-input" style={{ width: '88px', marginLeft: 'auto' }} value={returnQuantities[item.invoice_item_id] ?? 0} disabled={savingReturn} onChange={(event) => updateReturnQuantity(item, event.target.value)} /></td>
            </tr>)}</tbody>
          </table></div>
          <div className="form-group"><label className="form-label" htmlFor="sales-return-reason">Reason for return</label><input id="sales-return-reason" className="form-input" maxLength={500} placeholder="For example: damaged, wrong part, customer changed mind" value={returnReason} disabled={savingReturn} onChange={(event) => setReturnReason(event.target.value)} /></div>
          <div className="alert alert-warning" role="status">The final credit note is calculated from the original invoice, including its discount and GST. The selected item value before those adjustments is ₹{returnItemValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}. Stock and customer balance will change only after confirmation.</div>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" disabled={savingReturn} onClick={() => setReturnCandidate(null)}>Cancel</button><button type="button" className="btn btn-danger" disabled={savingReturn || selectedReturnItems.length === 0 || !returnReason.trim()} onClick={saveSalesReturn}>{savingReturn ? 'Creating credit note…' : 'Confirm Return & Credit'}</button></div>
      </div></div>}

      {showInvoiceModal && (
        <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '900px' }} role="dialog" aria-modal="true" aria-labelledby="invoice-modal-title">
          <form onSubmit={saveInvoice}>
            <div className="modal-header">
              <div>
                <h3 id="invoice-modal-title" className="modal-title">{editingInvoice ? `Edit ${editingInvoice.id}` : 'Create Sales Invoice'}</h3>
                {/* No invoice number is shown for a new sale: it is generated inside
                    jde_save_sales_invoice on the server and simply is not known until the save
                    comes back. An edit shows the real one, which is already in the title. */}
                <div className="text-muted text-sm flex items-center gap-2" style={{ marginTop: '3px', flexWrap: 'wrap' }}>
                  <span>Tax invoice under GST</span>
                  {placeOfSupply && <><span aria-hidden="true">·</span><span>Place of supply · {placeOfSupply}</span></>}
                  {!editingInvoice && <><span aria-hidden="true">·</span><span>Number assigned on save</span></>}
                </div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => { setShowInvoiceModal(false); setEditingInvoice(null); }}>✕</button>
            </div>
            <div className="modal-body flex flex-col gap-4">
              {invoiceError && <div className="alert alert-danger" role="alert">{invoiceError}</div>}

              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Customer</label>
                  <div className="flex gap-2">
                    <select className="form-input form-select" value={customer} onChange={(event) => setCustomer(event.target.value)}><option value="">Walk-in Sale (no customer)</option>{customers.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAddCustomer(true)}>+ New</button>
                  </div>
                  {/* Both of these are fields on the customer record itself — nothing is inferred. */}
                  {selectedCustomer ? (
                    <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                      {selectedCustomer.gstin
                        ? <span className="pn-chip">GSTIN {selectedCustomer.gstin}</span>
                        : <span className="text-muted text-sm">No GSTIN on file</span>}
                      {selectedCustomer.address && (
                        <span className="text-muted text-sm truncate" style={{ maxWidth: '260px' }}>{selectedCustomer.address}</span>
                      )}
                    </div>
                  ) : creditSaleNeedsCustomer ? (
                    // Said here, next to the field that fixes it, rather than only on save —
                    // being told at the end that the whole form is invalid is the worse version.
                    <span className="text-warning text-sm">Not fully paid — this sale needs a named customer before it can be saved.</span>
                  ) : (
                    <span className="text-muted text-sm">Walk-in sale — billed to the counter, no customer account.</span>
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label">Invoice Date</label>
                  <input type="date" className="form-input" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} />
                  <span className="text-muted text-sm">Date the goods leave the counter</span>
                </div>
              </div>

              <div className="table-wrap">
                <div className="tbl-toolbar">
                  <div className="tbl-toolbar-title">
                    <strong>Line items</strong>
                    <small>Pick a part from Inventory — its rate fills in from the catalogue sale price</small>
                  </div>
                </div>

                <datalist id="sales-part-options">{partOptions.map((part) => <option key={part.value} value={part.value} />)}</datalist>

                <div style={{ overflowX: 'auto' }}>
                  <table className="erp-table" style={{ minWidth: '780px' }}>
                    <thead>
                      <tr>
                        <th>Part &amp; Description</th>
                        <th style={{ width: '96px' }}>HSN</th>
                        <th className="text-right" style={{ width: '168px' }}>Qty</th>
                        <th className="text-right" style={{ width: '132px' }}>Rate</th>
                        <th className="text-right" style={{ width: '104px' }}>Disc %</th>
                        <th className="text-right" style={{ width: '150px' }}>Amount</th>
                        <th style={{ width: '54px' }} aria-label="Remove line"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, index) => {
                        const matched = partOptions.find((part) => part.value === line.part);
                        return (
                          <tr key={index}>
                            <td>
                              <input
                                list="sales-part-options"
                                className="form-input"
                                placeholder="Type or scan a part number…"
                                value={line.part}
                                onChange={(event) => { const selected = partOptions.find((part) => part.value === event.target.value); updateLine(index, { part: event.target.value, price: selected?.price ?? line.price }); }}
                              />
                              {/* Brand and stock are read straight off the matched product row. */}
                              {matched && (
                                <div className="flex items-center gap-2 mt-1" style={{ flexWrap: 'wrap' }}>
                                  <span className="pn-chip">{matched.partNumber}</span>
                                  {matched.brand && <span className="text-muted text-sm">{matched.brand} ·</span>}
                                  <span className="text-muted text-sm">{matched.stock} in stock</span>
                                </div>
                              )}
                              {line.part.trim() && !matched && <small className="text-danger">No matching part in Inventory</small>}
                            </td>
                            <td>
                              {matched?.hsn
                                ? <span className="pn-chip">{matched.hsn}</span>
                                : <span className="text-muted">—</span>}
                            </td>
                            <td>
                              {/* A stepper wrapped around the same number input as before: every
                                  path here writes through updateLine(index, { qty }), and neither
                                  button can take the quantity below one. */}
                              <div className="flex items-center gap-2" style={{ justifyContent: 'flex-end' }}>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  aria-label={`Decrease quantity on line ${index + 1}`}
                                  disabled={Number(line.qty) <= 1}
                                  onClick={() => updateLine(index, { qty: Math.max(1, Number(line.qty) - 1) })}
                                ><Minus size={12} /></button>
                                <input
                                  type="number"
                                  min="1"
                                  className="form-input"
                                  style={{ width: '62px', textAlign: 'center', padding: '7px 6px' }}
                                  aria-label={`Quantity on line ${index + 1}`}
                                  value={line.qty}
                                  onChange={(event) => updateLine(index, { qty: Number(event.target.value) })}
                                />
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  aria-label={`Increase quantity on line ${index + 1}`}
                                  onClick={() => updateLine(index, { qty: Math.max(1, Number(line.qty) + 1) })}
                                ><Plus size={12} /></button>
                              </div>
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                className="form-input"
                                style={{ textAlign: 'right' }}
                                aria-label={`Rate on line ${index + 1}`}
                                value={line.price}
                                onChange={(event) => updateLine(index, { price: Number(event.target.value) })}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.1"
                                className="form-input"
                                style={{ textAlign: 'right' }}
                                aria-label={`Discount percent on line ${index + 1}`}
                                value={line.discount ?? 0}
                                onChange={(event) => updateLine(index, { discount: Math.min(100, Math.max(0, Number(event.target.value))) })}
                              />
                            </td>
                            <td className="text-right font-semibold">
                              {lineDiscountPercent(line) > 0 && (
                                <div style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)', textDecoration: 'line-through' }}>
                                  ₹{paise(lineGross(line))}
                                </div>
                              )}
                              ₹{paise(lineNet(line))}
                            </td>
                            <td className="text-center">
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                aria-label={`Remove line ${index + 1}`}
                                title="Remove this line"
                                style={{ color: 'var(--color-danger)' }}
                                onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}
                              ><X size={14} /></button>
                            </td>
                          </tr>
                        );
                      })}
                      {lines.length === 0 && (
                        <tr><td colSpan={7}><div className="empty-state" style={{ padding: '28px 20px' }}>
                          <p className="empty-state-title">{partOptions.length === 0 ? 'No parts to sell yet' : 'No lines on this invoice'}</p>
                          <p className="empty-state-desc">{partOptions.length === 0 ? 'Add parts in Inventory before creating an invoice.' : 'Add a line below to start billing.'}</p>
                        </div></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="pager">
                  {partOptions.length > 0
                    ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLines((current) => [...current, { part: '', qty: 1, price: 0, discount: 0 }])}><Plus size={14} /> Add line — type or scan a part number</button>
                    : <span className="pager-info">Add parts in Inventory before creating an invoice.</span>}
                  <div className="pager-info"><strong>{lines.length}</strong> {lines.length === 1 ? 'line' : 'lines'}</div>
                </div>
              </div>

              <div className="form-grid-2">
                <div className="flex flex-col gap-4">
                  <div className="form-grid-2">
                    <div className="form-group">
                      <label className="form-label">Whole-invoice discount (%)</label>
                      <input type="number" min="0" max="100" step="0.1" className="form-input" value={discountPercent} onChange={(event) => setDiscountPercent(Math.min(100, Math.max(0, Number(event.target.value))))} />
                      <small className="text-muted">Applied on top of any per-item discounts. Leave at 0 to discount items only.</small>
                      <span className="text-muted text-sm">Applied on the subtotal</span>
                    </div>
                    <div className="form-group">
                      <label className="form-label">GST Rate (%)</label>
                      <input type="number" min="0" max="28" step="0.1" className="form-input" value={gstPercent} onChange={(event) => setGstPercent(Math.min(28, Math.max(0, Number(event.target.value))))} />
                      <div className="flex gap-2 mt-2" role="group" aria-label="How the rates on the lines are priced">
                        <button
                          type="button"
                          className={'btn btn-sm ' + (gstInclusive ? 'btn-secondary' : 'btn-primary')}
                          onClick={() => setGstInclusive(false)}
                        >GST extra</button>
                        <button
                          type="button"
                          className={'btn btn-sm ' + (gstInclusive ? 'btn-primary' : 'btn-secondary')}
                          onClick={() => setGstInclusive(true)}
                        >GST included</button>
                      </div>
                      {/* States what the typed rates mean, which is the part that is easy to get
                          wrong — the arithmetic below follows from it. */}
                      <span className="text-muted text-sm">
                        {gstInclusive
                          ? 'Line rates already include GST — the tax is taken out of them, and the total is what you typed.'
                          : 'Line rates are before GST — the tax is added on top of them.'}
                      </span>
                      {/* Only claims intra/inter-state when both GSTINs are on file to compare. */}
                      <span className="text-muted text-sm">
                        {supplyKind === 'intra'
                          ? 'Intra-state · CGST + SGST'
                          : supplyKind === 'inter'
                            ? 'Inter-state · IGST'
                            : 'Charged on the taxable value'}
                      </span>
                    </div>
                  </div>

                  <div className="form-grid-2">
                    <div className="form-group">
                      <label className="form-label">Payment Received</label>
                      <select className="form-input form-select" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value as PaymentStatus)}>
                        <option value="paid">Paid in Full</option>
                        <option value="partial">Partially Paid</option>
                        <option value="unpaid">Unpaid (Credit)</option>
                      </select>
                    </div>
                    {paymentStatus === 'partial' && (
                      <div className="form-group"><label className="form-label">Amount Received (₹)</label><input type="number" min="0" max={total} className="form-input" value={amountPaid} onChange={(event) => setAmountPaid(Number(event.target.value))} /></div>
                    )}
                  </div>
                </div>

                {/* Every figure below is read straight from the totals computed above — nothing
                    here is recalculated, and the CGST/SGST or IGST breakdown is a presentation
                    of the same gstAmount, never a second sum. */}
                <div className="card" style={{ background: 'var(--surface-2)' }}>
                  <div className="report-summary" style={{ maxWidth: 'none', margin: 0, padding: 0, gap: '0' }}>
                    {/* Shown only when line discounts are actually in use, so an invoice without
                        them reads exactly as it always did. */}
                    {itemDiscountTotal > 0 && (
                      <>
                        <div className="report-line"><span className="text-muted">Gross amount</span><strong>₹{paise(grossSubtotal)}</strong></div>
                        <div className="report-line">
                          <span className="text-muted">Item discounts</span>
                          <strong className="text-danger">-₹{paise(itemDiscountTotal)}</strong>
                        </div>
                      </>
                    )}
                    <div className="report-line"><span className="text-muted">Subtotal{itemDiscountTotal > 0 ? ' after item discounts' : ''}</span><strong>₹{paise(subtotal)}</strong></div>
                    <div className="report-line">
                      <span className="text-muted">Whole-invoice discount ({discountPercent}%)</span>
                      {discountAmount > 0
                        ? <strong className="text-danger">-₹{paise(discountAmount)}</strong>
                        : <strong>₹{paise(0)}</strong>}
                    </div>
                    {gstInclusive && (
                      <div className="report-line"><span className="text-muted">Amount after discounts (GST included)</span><strong>₹{paise(taxableAmount)}</strong></div>
                    )}
                    <div className="report-line report-strong"><span>Taxable value</span><strong>₹{paise(netTaxableValue)}</strong></div>
                    <div className="report-line">
                      <span className="text-muted">GST ({gstPercent}%){gstInclusive ? ' — included above' : ''}</span>
                      <strong>₹{paise(gstAmount)}</strong>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-2" style={{ flexWrap: 'wrap' }}>
                    {supplyKind === 'inter'
                      ? <span className="badge badge-muted">IGST {gstPercent}% · ₹{paise(gstAmount)}</span>
                      : <>
                          <span className="badge badge-muted">CGST {halfGstPercent}% · ₹{paise(gstAmount / 2)}</span>
                          <span className="badge badge-muted">SGST {halfGstPercent}% · ₹{paise(gstAmount / 2)}</span>
                        </>}
                  </div>

                  <div className="report-line mt-2" style={{ borderBottom: 'none', paddingBottom: 0 }}>
                    <span className="text-muted">Received</span>
                    <strong className="text-success">₹{paise(paidAmount)}</strong>
                  </div>

                  <div className="report-total mt-2" style={{ background: 'var(--amber-tint)', borderLeftColor: 'var(--amber)' }}>
                    <div>
                      <strong style={{ fontSize: '12.5px', color: 'var(--amber-3)' }}>Total Payable</strong>
                      <small>Inclusive of GST ₹{paise(gstAmount)}</small>
                    </div>
                    <strong style={{ color: 'var(--amber-3)' }}>₹{paise(total)}</strong>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <div className="text-muted text-sm" style={{ marginRight: 'auto', maxWidth: '340px' }}>
                {total <= 0
                  ? 'Add at least one line to bill this sale.'
                  : newOutstanding > 0
                    ? <>₹{paise(paidAmount)} received now · <strong>₹{paise(newOutstanding)}</strong> stays outstanding{selectedCustomer ? ` on ${selectedCustomer.name}'s account` : ' on this invoice'}.</>
                    : 'Settled in full — nothing will be added to any outstanding balance.'}
                {editingDraft && (
                  <div style={{ marginTop: '4px' }}>
                    That applies when you confirm it. <strong>Save &amp; Keep as Draft</strong> changes nothing on any account.
                  </div>
                )}
              </div>
              <button type="button" className="btn btn-secondary" onClick={() => { setShowInvoiceModal(false); setEditingInvoice(null); }}>Cancel</button>
              {/* Offered on a new sale and on a draft being edited, so a draft can be worked on
                  over several sittings. Not offered on a live invoice: that is already billed and
                  on a customer's account, and un-billing it here would erase a real debt. */}
              {(!editingInvoice || editingDraft) && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!total || savingInvoice || savingDraft}
                  onClick={saveDraftInvoice}
                >
                  {savingDraft ? 'Saving…' : editingDraft ? 'Save & Keep as Draft' : 'Save as Draft'}
                </button>
              )}
              <button type="submit" className="btn btn-primary" disabled={!total || savingInvoice || savingDraft || creditSaleNeedsCustomer}>
                {savingInvoice
                  ? 'Saving…'
                  : editingInvoice
                    ? editingInvoice.status === DRAFT_STATUS
                      ? `Confirm Invoice · ₹${paise(total)}`
                      : `Save Changes · ₹${paise(total)}`
                    : `Create Invoice · ₹${paise(total)}`}
              </button>
            </div>
          </form>
        </div></div>
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
