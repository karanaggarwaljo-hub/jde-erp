/**
 * A sales invoice in the GST "Tax Invoice" form Indian traders and their accountants know from
 * Tally: the seller's letterhead, Bill To / Ship To beside the invoice details, goods with HSN,
 * CGST and SGST (or IGST between states), the amount in words, the grand total, the HSN-wise tax
 * summary, the declaration and the signatory. The owner chose to leave PAN and bank details off.
 *
 * Pure: the printed page and the saved PDF both draw this, so they can never disagree. Every
 * figure comes from what the invoice stored (lib/invoice-figures.ts); the state and state code come
 * from the GSTINs, so nothing is made up.
 */

import { invoiceFigures, type FigureInvoice, type FigureItem, type FigureReturn } from './invoice-figures';
import { GST_STATES, supplyTax } from './gst-supply';

export { GST_STATES };

export type TallyCompany = {
  name: string;
  address?: string | null;
  gstin?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  invoice_declaration?: string | null;
};

export type TallyCustomer = { address?: string | null; phone?: string | null; gstin?: string | null } | null;

export type TallyInvoiceInput = FigureInvoice & {
  id: string;
  date: string;
  customer: string;
  mode?: string | null;
  /** State code chosen on the bill. */
  place_of_supply?: string | null;
  status?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
};

export type TallyItemInput = FigureItem & {
  part_number?: string | null;
  name: string;
  qty: number | string;
  unit_price: number | string;
  /** From the part (jde_products.hsn_code). */
  hsn?: string | null;
};

export type Party = { name: string; lines: string[]; gstin: string; state: string; stateCode: string; phone: string; email: string };

export type TallyItem = { sl: number; description: string; partNumber: string; hsn: string; qty: string; unit: string; rate: string; discount: string; amount: string };

/** A line under the goods: a deduction, a tax, or the total. `amount` is already formatted. */
export type TallyCharge = { label: string; rate: string; amount: string; strong?: boolean };

export type TaxRow = { hsn: string; taxable: string; cgstRate: string; cgst: string; sgstRate: string; sgst: string; igstRate: string; igst: string; totalTax: string };

export type TallyInvoice = {
  title: string;
  subtitle: string;
  seller: Party;
  buyer: Party;
  /** The invoice details beside Bill To / Ship To: [label, value] pairs, one per line. */
  details: Array<[string, string]>;
  items: TallyItem[];
  totalQty: string;
  /** The goods added up, before anything below them. */
  itemsTotal: string;
  charges: TallyCharge[];
  total: string;
  amountInWords: string;
  interState: boolean;
  /** The state half of intra-state GST: SGST, or UTGST in a Union Territory without a legislature. */
  localTax: 'SGST' | 'UTGST';
  /** Its column heading in the tax summary. */
  localTaxColumn: 'State Tax' | 'UT Tax';
  /** The figures are GST-inclusive: the item amounts already contain the tax. */
  inclusive: boolean;
  taxRows: TaxRow[];
  taxTotal: TaxRow;
  taxInWords: string;
  declaration: string;
  /** What has been received and what is still owed — not on a Tally invoice, but asked at the counter. */
  payment: { paid: string; balance: string; writtenOff: string } | null;
  emptyNote: string | null;
  /** Set on a cancelled invoice: printed across it, with when and why. */
  cancelled: { on: string; reason: string } | null;
};

const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const text = (value: unknown) => String(value ?? '').trim();
const round2 = (value: number) => Math.round(value * 100) / 100;

/** 1234567.5 → "12,34,567.50": Indian grouping, always two decimals. */
export function indianAmount(value: number): string {
  const negative = value < 0;
  const [whole, paise] = Math.abs(round2(value)).toFixed(2).split('.');
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${rest ? `${rest},${last3}` : last3}.${paise}`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number): string {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
}

/** Whole rupees in words, Indian style: 1,25,000 → "One Lakh Twenty Five Thousand". */
export function rupeesInWords(whole: number): string {
  let n = Math.floor(Math.abs(whole));
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${crore >= 1000 ? rupeesInWords(crore) : crore >= 100 ? belowThousand(crore) : belowHundred(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return parts.join(' ');
}

/** "INR Ten Thousand Six Hundred and Fifty Paise Only", as Tally writes it. */
export function amountInWords(value: number): string {
  const rounded = round2(Math.abs(value));
  const whole = Math.floor(rounded);
  const paise = Math.round((rounded - whole) * 100);
  return `INR ${rupeesInWords(whole)}${paise ? ` and ${belowHundred(paise)} paise` : ''} Only`;
}

/** The state code and name a GSTIN belongs to, or blanks when it is not a GSTIN. */
export function stateOfGstin(gstin: string | null | undefined): { code: string; name: string } {
  const value = text(gstin).toUpperCase();
  const code = /^\d{2}[A-Z0-9]{13}$/.test(value) ? value.slice(0, 2) : '';
  return { code, name: GST_STATES[code] ?? '' };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-10-21 → "21-Oct-2026". */
export function tallyDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(iso));
  if (!match) return text(iso);
  return `${Number(match[3])}-${MONTHS[Number(match[2]) - 1] ?? match[2]}-${match[1]}`;
}

const MODE_LABELS: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank Transfer', bank_transfer: 'Bank Transfer', cheque: 'Cheque', credit: 'Credit' };

function addressLines(address: string | null | undefined): string[] {
  return text(address).split(/\r?\n|,\s*(?=\S)/).map((line) => line.trim()).filter(Boolean).slice(0, 4);
}

function percentText(value: number): string {
  return `${Number.isInteger(value) ? value : round2(value)}%`;
}

export const DEFAULT_DECLARATION = 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.';

export function buildTallyInvoice(source: {
  invoice: TallyInvoiceInput;
  items: TallyItemInput[];
  company: TallyCompany;
  customer: TallyCustomer;
  returns?: FigureReturn[];
}): TallyInvoice {
  const { invoice, items, company, customer } = source;
  const f = invoiceFigures(invoice, items, source.returns ?? []);
  const total = num(invoice.total);
  const paid = num(invoice.paid);

  const sellerState = stateOfGstin(company.gstin);
  // Where the goods go decides the tax (lib/gst-supply.ts): IGST to another state, else CGST plus
  // SGST, or UTGST when the seller is in a Union Territory without a legislature (Chandigarh).
  const supply = supplyTax(company.gstin, customer?.gstin, invoice.place_of_supply);
  const interState = supply.kind === 'inter';

  // Older bills stored the tax but not its rate; it is worked back out from the tax and what it was
  // charged on (Rs. 45 on Rs. 250 is 18%), rather than printed as 0%.
  const storedRate = num(invoice.gst_percent);
  const rate = storedRate > 0 ? storedRate
    : f.gstAmount > 0.005 && f.netTaxableValue > 0 ? Math.round((f.gstAmount / f.netTaxableValue) * 10000) / 100 : 0;
  const tallyItems: TallyItem[] = items.map((item, index) => {
    const lineDiscount = num(item.discount_percent);
    return {
      sl: index + 1,
      description: text(item.name) || 'Item',
      partNumber: text(item.part_number),
      hsn: text(item.hsn),
      qty: String(num(item.qty)),
      unit: 'Pcs',
      rate: indianAmount(num(item.unit_price)),
      discount: lineDiscount > 0 ? percentText(lineDiscount) : '',
      amount: indianAmount(num(item.line_total)),
    };
  });

  // Under the goods: what was returned, the bill discount, then the tax, as Tally lists them.
  const charges: TallyCharge[] = [];
  if (f.returnedValue > 0) charges.push({ label: `Less: Goods returned (${f.returnIds.join(', ')})`, rate: '', amount: `-${indianAmount(f.returnedValue)}` });
  if (f.discountAmount > 0) charges.push({ label: 'Less: Discount', rate: percentText(num(invoice.discount_percent)), amount: `-${indianAmount(f.discountAmount)}` });
  const tax = f.gstAmount > 0.005 ? f.gstAmount : 0;
  const halfOne = round2(tax / 2);
  const halfTwo = round2(tax - halfOne);
  if (items.length > 0 && tax > 0) {
    const suffix = f.gstInclusive ? ' (included)' : '';
    if (interState) charges.push({ label: `IGST${suffix}`, rate: percentText(rate), amount: indianAmount(tax) });
    else {
      charges.push({ label: `CGST${suffix}`, rate: percentText(rate / 2), amount: indianAmount(halfOne) });
      charges.push({ label: `${supply.localTax}${suffix}`, rate: percentText(rate / 2), amount: indianAmount(halfTwo) });
    }
  }

  // HSN-wise summary. The bill's taxable value is shared out over its lines by what each line was
  // charged, then gathered by HSN code; the last group takes any paisa left by rounding, so the
  // groups always add up to the bill.
  const taxable = items.length > 0 ? f.netTaxableValue : 0;
  const groups = new Map<string, number>();
  const lineSum = items.reduce((sum, item) => sum + num(item.line_total), 0);
  for (const item of items) {
    const key = text(item.hsn);
    groups.set(key, (groups.get(key) ?? 0) + (lineSum > 0 ? num(item.line_total) / lineSum : 1 / items.length));
  }
  const keys = [...groups.keys()];
  let taxableLeft = round2(taxable);
  let taxLeft = round2(tax);
  const taxRows: TaxRow[] = keys.map((key, index) => {
    const last = index === keys.length - 1;
    const share = groups.get(key) ?? 0;
    const rowTaxable = last ? taxableLeft : round2(taxable * share);
    const rowTax = last ? taxLeft : round2(tax * share);
    taxableLeft = round2(taxableLeft - rowTaxable);
    taxLeft = round2(taxLeft - rowTax);
    const a = round2(rowTax / 2);
    return taxRow(key, rowTaxable, rowTax, a, round2(rowTax - a), rate, interState);
  });
  // Tally leaves the rate blank on the total line: it adds amounts, not rates.
  const taxTotal = { ...taxRow('Total', round2(taxable), round2(tax), halfOne, halfTwo, rate, interState), cgstRate: '', sgstRate: '', igstRate: '' };

  return {
    title: 'Tax Invoice',
    subtitle: '(Invoice Under Rule 46 of the GST Tax Rules, 2017)',
    seller: {
      name: text(company.name) || 'Company',
      lines: addressLines(company.address),
      gstin: text(company.gstin).toUpperCase(),
      state: sellerState.name,
      stateCode: sellerState.code,
      phone: text(company.contact_phone),
      email: text(company.contact_email),
    },
    buyer: {
      name: text(invoice.customer) || 'Cash',
      lines: addressLines(customer?.address),
      gstin: text(customer?.gstin).toUpperCase(),
      state: supply.placeName,
      stateCode: supply.placeCode,
      phone: text(customer?.phone),
      email: '',
    },
    details: [
      ['Invoice No.', text(invoice.id)],
      ['Date', tallyDate(invoice.date)],
      ['Payment Terms', MODE_LABELS[text(invoice.mode).toLowerCase()] ?? text(invoice.mode)],
      ['Disp Through', ''],
      ['Terms of Delivery', ''],
      ['Destination', ''],
      ['Other Reference', ''],
      ['E-Way Bill No.', ''],
    ],
    items: tallyItems,
    totalQty: `${items.reduce((sum, item) => sum + num(item.qty), 0)}`,
    itemsTotal: indianAmount(f.subtotal),
    charges,
    total: indianAmount(total),
    amountInWords: amountInWords(total),
    interState,
    localTax: supply.localTax,
    localTaxColumn: supply.localTaxColumn,
    inclusive: f.gstInclusive,
    taxRows,
    taxTotal,
    taxInWords: amountInWords(tax),
    declaration: text(company.invoice_declaration) || DEFAULT_DECLARATION,
    payment: invoice.status !== 'cancelled' && (paid > 0 || f.writtenOff > 0)
      ? { paid: indianAmount(paid), balance: indianAmount(f.balanceDue), writtenOff: f.writtenOff > 0 ? indianAmount(f.writtenOff) : '' }
      : null,
    emptyNote: items.length === 0 ? 'Line items were not recorded for this older invoice; only the total is available.' : null,
    cancelled: invoice.status === 'cancelled'
      ? { on: invoice.cancelled_at ? tallyDate(String(invoice.cancelled_at).slice(0, 10)) : '', reason: text(invoice.cancel_reason) }
      : null,
  };
}

function taxRow(hsn: string, taxable: number, tax: number, cgst: number, sgst: number, rate: number, interState: boolean): TaxRow {
  return {
    hsn,
    taxable: indianAmount(taxable),
    cgstRate: interState || !tax ? '' : percentText(rate / 2),
    cgst: interState ? '' : indianAmount(cgst),
    sgstRate: interState || !tax ? '' : percentText(rate / 2),
    sgst: interState ? '' : indianAmount(sgst),
    igstRate: interState && tax ? percentText(rate) : '',
    igst: interState ? indianAmount(tax) : '',
    totalTax: indianAmount(tax),
  };
}

/** A cancelled invoice's figures are zeroed and its lines gone (scripts/cancel-sales-invoice.sql), but
 *  it keeps a copy of itself as issued. This returns what to print: that copy, marked cancelled, or
 *  the invoice and lines as they are when it was never cancelled. */
export function asIssued<I extends Record<string, unknown>, L>(invoice: I, items: L[]): { invoice: I; items: L[] } {
  const copy = invoice.cancelled_copy as { invoice?: Record<string, unknown>; items?: L[] } | null | undefined;
  if (invoice.status !== 'cancelled' || !copy?.invoice) return { invoice, items };
  return {
    invoice: { ...copy.invoice, status: 'cancelled', cancelled_at: invoice.cancelled_at, cancel_reason: invoice.cancel_reason, place_of_supply: invoice.place_of_supply ?? copy.invoice.place_of_supply } as unknown as I,
    items: copy.items ?? [],
  };
}
