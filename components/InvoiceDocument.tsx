'use client';

import { Printer, X } from 'lucide-react';

/* =========================================================================================
   InvoiceDocument — the finished tax invoice, ready to print.

   Presentational only. It fetches nothing, holds no state and mutates nothing: every figure
   on the page is handed in by the caller, already computed and already saved. Nothing here
   recalculates a total, and nothing here invents a value — a field the invoice does not
   carry is simply left off the paper rather than filled with a placeholder.
   ========================================================================================= */

export type InvoiceDocumentLine = {
  part_number: string;
  name: string;
  hsn?: string;
  qty: number;
  unit_price: number;
  line_total: number;
};

export type InvoiceDocumentProps = {
  invoiceId: string;                 // already assigned by the server
  date: string;                      // ISO yyyy-mm-dd
  status: string;
  company: { name: string; gstin: string; address: string; contact_phone?: string | null; contact_email?: string | null } | null;
  customer: { name: string; gstin?: string; address?: string; phone?: string } | null;
  lines: InvoiceDocumentLine[];
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  taxableValue: number;
  gstPercent: number | null;         // null when the rate was never recorded
  gstAmount: number | null;          // null when unknown
  isInterState: boolean;             // true -> IGST, false -> CGST + SGST
  total: number;
  paid: number;
  onClose: () => void;
  onPrint: () => void;
};

/* -----------------------------------------------------------------------------------------
   Reference data, not business data: the statutory GST state codes, which are the first two
   digits of every GSTIN. Used only to name the place of supply. Nothing in this table is a
   figure, a price or a company-specific value.
   ----------------------------------------------------------------------------------------- */
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

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Indian digit grouping with paise, matching the Sales screen. Display only — nothing rounded
// here is ever written back.
const paise = (value: number) => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyText = (value: number) => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const percentText = (value: number) => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** yyyy-mm-dd -> "24 Aug 2026". Formatted by hand rather than through a locale so the same
 *  string is produced everywhere; an unparseable value is shown exactly as it was stored. */
function formatDate(iso: string): string {
  const raw = (iso ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!match) return raw;
  const [, year, month, day] = match;
  const name = MONTH_NAMES[Number(month) - 1];
  return name ? `${day} ${name} ${year}` : raw;
}

/* -----------------------------------------------------------------------------------------
   Amount in words — a legal nicety on an Indian tax invoice. Derived from the grand total the
   caller passes in, never a separate sum, and grouped the Indian way (crore / lakh / thousand)
   rather than the western million / billion.
   ----------------------------------------------------------------------------------------- */
const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function underHundred(n: number): string {
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  const ones = ONES[n % 10];
  return ones ? `${tens} ${ones}` : tens;
}

function underThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(underHundred(rest));
  return parts.join(' ');
}

function wholeToWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  // Anything past 99 crore is read back as "<n> Crore", so the same grouping recurses.
  if (crore) parts.push(`${wholeToWords(crore)} Crore`);
  if (lakh) parts.push(`${underHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${underHundred(thousand)} Thousand`);
  if (rest) parts.push(underThousand(rest));
  return parts.join(' ');
}

export function amountInWords(amount: number): string {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return '';
  // Counted in paise so the usual binary-fraction drift can never add or drop a stray paisa.
  const totalPaise = Math.round(value * 100);
  const rupees = Math.floor(totalPaise / 100);
  const remainder = totalPaise % 100;
  const rupeeWords = `Rupees ${wholeToWords(rupees)}`;
  return remainder ? `${rupeeWords} and ${underHundred(remainder)} Paise Only` : `${rupeeWords} Only`;
}

export default function InvoiceDocument({
  invoiceId,
  date,
  status,
  company,
  customer,
  lines,
  subtotal,
  discountPercent,
  discountAmount,
  taxableValue,
  gstPercent,
  gstAmount,
  isInterState,
  total,
  paid,
  onClose,
  onPrint,
}: InvoiceDocumentProps) {
  const isDraft = (status ?? '').trim().toLowerCase() === 'draft';

  // Place of supply is read off the seller's own GSTIN — the first two digits are the statutory
  // state code. No GSTIN, or a code that is not in the statutory list, means there is nothing to
  // state, so the whole line is dropped rather than guessed.
  const stateCode = (company?.gstin ?? '').trim().slice(0, 2);
  const stateName = GST_STATE_NAMES[stateCode];
  const placeOfSupply = stateName ? `${stateName} (${stateCode})` : '';

  // CGST and SGST are half the recorded rate each and half the recorded amount each. This is a
  // presentation of the one gstAmount the invoice already carries, never a second sum.
  const halfGstPercent = gstPercent === null ? null : Number((gstPercent / 2).toFixed(3));
  const halfGstAmount = gstAmount === null ? null : gstAmount / 2;

  const balanceDue = total - paid;
  const showPaymentLines = paid > 0 || balanceDue > 0;
  const words = amountInWords(total);

  const sellerContact = company ? [company.contact_phone, company.contact_email].filter(Boolean).join(' · ') : '';

  return (
    <div className="modal-overlay">
      <div
        className="modal-box"
        style={{ maxWidth: '820px' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invoice-document-heading"
      >
        <div className="modal-header">
          <h3 id="invoice-document-heading" className="modal-title">Invoice {invoiceId}</h3>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body">
          {/* .invoice-doc is the root the print rules key off: on paper this subtree is the
              only thing that is inked, and everything around it — sidebar, topbar, the dialog
              frame, these buttons — steps out of the way. */}
          <article className="invoice-doc" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>

            <header className="flex justify-between gap-4" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ fontSize: '21px', fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--ink)' }}>Tax Invoice</h2>
                {isDraft && (
                  <div className="mt-1">
                    <span className="badge badge-warning">DRAFT — not yet issued</span>
                  </div>
                )}
              </div>
              <div className="text-right" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <div className="text-sm">
                  <span className="text-muted">Invoice No. </span>
                  <strong style={{ fontSize: '14px', color: 'var(--ink)' }}>{invoiceId}</strong>
                </div>
                <div className="text-sm">
                  <span className="text-muted">Date </span>
                  <strong style={{ fontSize: '14px', color: 'var(--ink)' }}>{formatDate(date)}</strong>
                </div>
              </div>
            </header>

            <div className="divider" style={{ margin: 0 }} />

            <div className="form-grid-2">
              {company && (
                <section>
                  <div className="eyebrow">Sold by</div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink)', marginTop: '5px' }}>{company.name}</div>
                  {company.gstin && (
                    <div className="text-sm" style={{ color: 'var(--ink-2)', marginTop: '3px', fontVariantNumeric: 'tabular-nums' }}>
                      GSTIN {company.gstin}
                    </div>
                  )}
                  {company.address && (
                    <div className="text-sm" style={{ color: 'var(--ink-2)', marginTop: '3px', whiteSpace: 'pre-line' }}>{company.address}</div>
                  )}
                  {sellerContact && (
                    <div className="text-sm" style={{ color: 'var(--ink-2)', marginTop: '3px' }}>{sellerContact}</div>
                  )}
                </section>
              )}

              <section>
                <div className="eyebrow">Billed to</div>
                {customer ? (
                  <>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink)', marginTop: '5px' }}>{customer.name}</div>
                    {customer.gstin && (
                      <div className="text-sm" style={{ color: 'var(--ink-2)', marginTop: '3px', fontVariantNumeric: 'tabular-nums' }}>
                        GSTIN {customer.gstin}
                      </div>
                    )}
                    {customer.address && (
                      <div className="text-sm" style={{ color: 'var(--ink-2)', marginTop: '3px', whiteSpace: 'pre-line' }}>{customer.address}</div>
                    )}
                    {customer.phone && (
                      <div className="text-sm" style={{ color: 'var(--ink-2)', marginTop: '3px', fontVariantNumeric: 'tabular-nums' }}>{customer.phone}</div>
                    )}
                  </>
                ) : (
                  /* A walk-in has no account, so there is no billing name, GSTIN or address to
                     print. Saying that plainly is honest; empty labelled fields are not. */
                  <div className="text-sm" style={{ color: 'var(--ink-2)', marginTop: '5px' }}>
                    Walk-in sale, billed at the counter. No customer account, so no billing name, GSTIN or address is on record.
                  </div>
                )}
              </section>
            </div>

            {placeOfSupply && (
              <div className="text-sm">
                <span className="text-muted">Place of supply · </span>
                <strong style={{ color: 'var(--ink)' }}>{placeOfSupply}</strong>
              </div>
            )}

            <div className="table-wrap">
              <table className="erp-table">
                <thead>
                  <tr>
                    <th className="text-right" style={{ width: '42px' }}>#</th>
                    <th>Part No.</th>
                    <th>Description</th>
                    <th>HSN</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Rate</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={`${line.part_number}-${index}`}>
                      <td className="text-right">{index + 1}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{line.part_number}</td>
                      <td>{line.name}</td>
                      {/* HSN is genuinely optional on the part record, so a blank one is shown
                          as a dash rather than as a code that was never entered. */}
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{line.hsn && line.hsn.trim() ? line.hsn.trim() : '—'}</td>
                      <td className="text-right">{qtyText(line.qty)}</td>
                      <td className="text-right">₹{paise(line.unit_price)}</td>
                      <td className="text-right"><strong>₹{paise(line.line_total)}</strong></td>
                    </tr>
                  ))}
                  {lines.length === 0 && (
                    <tr><td colSpan={7} className="text-muted">No line items are recorded on this invoice.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ width: '100%', maxWidth: '380px' }}>
                <div className="report-summary" style={{ maxWidth: 'none', margin: 0, padding: 0, gap: 0 }}>
                  <div className="report-line"><span className="text-muted">Subtotal</span><strong>₹{paise(subtotal)}</strong></div>

                  {/* A discount only appears when one was actually given. */}
                  {discountAmount > 0 && (
                    <div className="report-line">
                      <span className="text-muted">Discount ({percentText(discountPercent)}%)</span>
                      <strong className="text-danger">-₹{paise(discountAmount)}</strong>
                    </div>
                  )}

                  <div className="report-line report-strong"><span>Taxable value</span><strong>₹{paise(taxableValue)}</strong></div>

                  {/* With no rate recorded there is no honest tax line to print, so none is
                      printed and the note below says why. A rate is never assumed. */}
                  {gstAmount !== null && (
                    isInterState ? (
                      <div className="report-line">
                        <span className="text-muted">IGST{gstPercent !== null ? ` (${percentText(gstPercent)}%)` : ''}</span>
                        <strong>₹{paise(gstAmount)}</strong>
                      </div>
                    ) : (
                      <>
                        <div className="report-line">
                          <span className="text-muted">CGST{halfGstPercent !== null ? ` (${percentText(halfGstPercent)}%)` : ''}</span>
                          <strong>₹{paise(halfGstAmount ?? 0)}</strong>
                        </div>
                        <div className="report-line">
                          <span className="text-muted">SGST{halfGstPercent !== null ? ` (${percentText(halfGstPercent)}%)` : ''}</span>
                          <strong>₹{paise(halfGstAmount ?? 0)}</strong>
                        </div>
                      </>
                    )
                  )}
                </div>

                <div className="report-total mt-2" style={{ background: 'var(--amber-tint)', borderLeftColor: 'var(--amber)' }}>
                  <div>
                    <strong style={{ fontSize: '12.5px', color: 'var(--amber-3)' }}>Grand Total</strong>
                    {gstAmount !== null && <small>Inclusive of GST ₹{paise(gstAmount)}</small>}
                  </div>
                  <strong style={{ color: 'var(--amber-3)' }}>₹{paise(total)}</strong>
                </div>

                {showPaymentLines && (
                  <div className="report-summary" style={{ maxWidth: 'none', margin: '8px 0 0', padding: 0, gap: 0 }}>
                    <div className="report-line">
                      <span className="text-muted">Amount received</span>
                      <strong className="text-success">₹{paise(paid)}</strong>
                    </div>
                    <div className="report-line">
                      <span className="text-muted">Balance due</span>
                      <strong className={balanceDue > 0 ? 'text-danger' : undefined}>₹{paise(balanceDue)}</strong>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {gstAmount === null && (
              <div className="alert alert-warning" role="note">
                No GST rate was recorded against this invoice, so no tax has been shown. The grand
                total above is the amount held on the invoice record.
              </div>
            )}

            {words && (
              <div className="card card-sm" style={{ background: 'var(--surface-2)' }}>
                <div className="eyebrow">Amount in words</div>
                <div className="mt-1" style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--ink)' }}>{words}</div>
              </div>
            )}

            <footer
              className="flex justify-between gap-4"
              style={{ borderTop: '1px solid var(--line-2)', paddingTop: '14px', alignItems: 'flex-start', flexWrap: 'wrap' }}
            >
              <div className="text-sm text-muted" style={{ maxWidth: '380px' }}>
                This is a computer-generated tax invoice{company ? ` issued by ${company.name}` : ''}.
              </div>
              {company && (
                <div className="text-right text-sm" style={{ color: 'var(--ink-2)' }}>
                  <div>For <strong style={{ color: 'var(--ink)' }}>{company.name}</strong></div>
                  <div className="text-muted" style={{ marginTop: '30px' }}>Authorised Signatory</div>
                </div>
              )}
            </footer>
          </article>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-primary" onClick={onPrint}><Printer size={14} /> Print</button>
        </div>
      </div>
    </div>
  );
}
