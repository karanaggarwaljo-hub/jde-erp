/**
 * A sales invoice as Tally prints a GST Tax Invoice (lib/tally-invoice.ts builds what goes in it).
 * Black on white in every theme: it is a paper document, and what is on screen is what prints.
 */

import type { TallyInvoice } from '@/lib/tally-invoice';

const CSS = `
.tally { background:#fff; color:#000; font-family: Arial, Helvetica, sans-serif; font-size:11px; line-height:1.35; max-width:800px; margin:0 auto; }
.tally * { box-sizing:border-box; }
.tally .t-title { text-align:center; font-weight:700; font-size:15px; letter-spacing:.5px; margin:0 0 4px; }
.tally .t-box { border:1px solid #000; }
.tally .t-row { display:flex; border-bottom:1px solid #000; }
.tally .t-row:last-child { border-bottom:0; }
.tally .t-half { flex:1 1 50%; min-width:0; }
.tally .t-half + .t-half { border-left:1px solid #000; }
.tally .t-pad { padding:4px 6px; }
.tally .t-label { font-size:10px; }
.tally .t-strong { font-weight:700; }
.tally .t-name { font-weight:700; font-size:13px; }
.tally .t-grid { display:grid; grid-template-columns:1fr 1fr; height:100%; }
.tally .t-grid > div { padding:3px 6px; border-bottom:1px solid #000; min-height:30px; }
.tally .t-grid > div:nth-child(odd) { border-right:1px solid #000; }
.tally .t-grid > div:nth-last-child(-n+2) { border-bottom:0; }
.tally table { width:100%; border-collapse:collapse; }
.tally th, .tally td { padding:3px 5px; vertical-align:top; }
.tally .t-items th { border-bottom:1px solid #000; font-weight:400; font-size:10px; text-align:center; }
.tally .t-items th + th, .tally .t-items td + td { border-left:1px solid #000; }
.tally .t-items td { border-bottom:0; }
.tally .t-items tr.t-total td { border-top:1px solid #000; }
.tally .t-items .t-fill td { height:24px; }
.tally .r { text-align:right; white-space:nowrap; }
.tally .c { text-align:center; }
.tally .t-charge td:nth-child(2) { text-align:right; font-style:italic; font-weight:700; }
.tally .t-tax th, .tally .t-tax td { border:1px solid #000; font-size:10px; }
.tally .t-tax { margin:0; }
.tally .t-tax tr:first-child th { border-top:0; }
.tally .t-tax th:first-child, .tally .t-tax td:first-child { border-left:0; }
.tally .t-tax th:last-child, .tally .t-tax td:last-child { border-right:0; }
.tally .t-tax tr:last-child td { border-bottom:0; }
.tally .t-sign { display:flex; flex-direction:column; justify-content:space-between; min-height:70px; text-align:right; }
.tally .t-foot { text-align:center; font-size:10px; margin-top:4px; }
.tally .t-sub { font-size:10px; font-style:italic; }
@media print { .tally { max-width:none; } }
`;

export default function TallyInvoiceSheet({ doc }: { doc: TallyInvoice }) {
  const intra = !doc.interState;
  return (
    <div className="tally">
      <style>{CSS}</style>
      <p className="t-title">{doc.title}</p>
      <div className="t-box">
        {/* Seller | invoice details */}
        <div className="t-row">
          <div className="t-half t-pad">
            <div className="t-name">{doc.seller.name}</div>
            {doc.seller.lines.map((line) => <div key={line}>{line}</div>)}
            {doc.seller.gstin && <div>GSTIN/UIN: <span className="t-strong">{doc.seller.gstin}</span></div>}
            {doc.seller.state && <div>State Name : {doc.seller.state}, Code : {doc.seller.stateCode}</div>}
            {doc.seller.phone && <div>Contact : {doc.seller.phone}</div>}
            {doc.seller.email && <div>E-Mail : {doc.seller.email}</div>}
          </div>
          <div className="t-half">
            <div className="t-grid">
              {doc.details.map(([label, value], index) => (
                <div key={`${label}-${index}`}><div className="t-label">{label}</div><div className="t-strong">{value}</div></div>
              ))}
            </div>
          </div>
        </div>

        {/* Buyer | terms of delivery */}
        <div className="t-row">
          <div className="t-half t-pad">
            <div className="t-label">Buyer (Bill to)</div>
            <div className="t-name">{doc.buyer.name}</div>
            {doc.buyer.lines.map((line) => <div key={line}>{line}</div>)}
            {doc.buyer.gstin && <div>GSTIN/UIN : <span className="t-strong">{doc.buyer.gstin}</span></div>}
            {doc.buyer.state && <div>State Name : {doc.buyer.state}, Code : {doc.buyer.stateCode}</div>}
            {doc.buyer.phone && <div>Contact : {doc.buyer.phone}</div>}
          </div>
          <div className="t-half t-pad"><div className="t-label">Terms of Delivery</div></div>
        </div>

        {/* Goods, the lines under them, and the total */}
        <div className="t-row">
          <table className="t-items">
            <thead>
              <tr>
                <th style={{ width: 30 }}>Sl No.</th>
                <th>Description of Goods</th>
                <th style={{ width: 72 }}>HSN/SAC</th>
                <th style={{ width: 62 }}>Quantity</th>
                <th style={{ width: 70 }}>Rate</th>
                <th style={{ width: 34 }}>per</th>
                <th style={{ width: 44 }}>Disc. %</th>
                <th style={{ width: 90 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {doc.items.map((item) => (
                <tr key={item.sl}>
                  <td className="c">{item.sl}</td>
                  <td><span className="t-strong">{item.description}</span>{item.partNumber && <div className="t-sub">Part No. {item.partNumber}</div>}</td>
                  <td className="c">{item.hsn}</td>
                  <td className="r t-strong">{item.qty} {item.unit}</td>
                  <td className="r">{item.rate}</td>
                  <td className="c">{item.unit}</td>
                  <td className="r">{item.discount}</td>
                  <td className="r t-strong">{item.amount}</td>
                </tr>
              ))}
              {doc.emptyNote && <tr><td /><td colSpan={6}><em>{doc.emptyNote}</em></td><td /></tr>}
              <tr className="t-fill"><td /><td /><td /><td /><td /><td /><td /><td /></tr>
              {doc.charges.map((charge) => (
                <tr key={charge.label} className="t-charge">
                  <td /><td>{charge.label}</td><td /><td /><td className="r">{charge.rate}</td><td /><td /><td className="r t-strong">{charge.amount}</td>
                </tr>
              ))}
              <tr className="t-total">
                <td /><td className="r">Total</td><td /><td className="r t-strong">{doc.totalQty}</td><td /><td /><td /><td className="r t-strong" style={{ fontSize: 13 }}>₹ {doc.total}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Amount in words */}
        <div className="t-row t-pad" style={{ display: 'block' }}>
          <div className="flex justify-between"><span className="t-label">Amount Chargeable (in words)</span><span className="t-label">E. &amp; O.E</span></div>
          <div className="t-strong">{doc.amountInWords}</div>
        </div>

        {/* HSN-wise tax summary */}
        <div className="t-row">
          <table className="t-tax">
            <thead>
              <tr>
                <th rowSpan={2}>HSN/SAC</th>
                <th rowSpan={2}>Taxable Value</th>
                {intra ? <><th colSpan={2}>Central Tax</th><th colSpan={2}>State Tax</th></> : <th colSpan={2}>Integrated Tax</th>}
                <th rowSpan={2}>Total Tax Amount</th>
              </tr>
              <tr>
                <th>Rate</th><th>Amount</th>
                {intra && <><th>Rate</th><th>Amount</th></>}
              </tr>
            </thead>
            <tbody>
              {[...doc.taxRows, doc.taxTotal].map((row, index) => {
                const isTotal = index === doc.taxRows.length;
                return (
                  <tr key={`${row.hsn}-${index}`} className={isTotal ? 't-strong' : ''}>
                    <td className={isTotal ? 'r' : ''}>{row.hsn}</td>
                    <td className="r">{row.taxable}</td>
                    {intra
                      ? <><td className="r">{row.cgstRate}</td><td className="r">{row.cgst}</td><td className="r">{row.sgstRate}</td><td className="r">{row.sgst}</td></>
                      : <><td className="r">{row.igstRate}</td><td className="r">{row.igst}</td></>}
                    <td className="r">{row.totalTax}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="t-row t-pad" style={{ display: 'block' }}>
          <span className="t-label">Tax Amount (in words) : </span><span className="t-strong">{doc.taxInWords}</span>
          {doc.inclusive && <div className="t-sub">Prices include GST.</div>}
        </div>

        {/* PAN, declaration | bank details, signature */}
        <div className="t-row">
          <div className="t-half t-pad" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 8 }}>
            <div>{doc.seller.pan && <>Company&apos;s PAN : <span className="t-strong">{doc.seller.pan}</span></>}</div>
            <div><div className="t-label" style={{ textDecoration: 'underline' }}>Declaration</div><div>{doc.declaration}</div></div>
            <div style={{ marginTop: 18 }}>Customer&apos;s Seal and Signature</div>
          </div>
          <div className="t-half">
            <div className="t-pad" style={{ borderBottom: '1px solid #000' }}>
              <div className="t-label">Company&apos;s Bank Details</div>
              {doc.bank ? (
                <table style={{ fontSize: 11 }}>
                  <tbody>
                    <tr><td style={{ padding: 0, width: 110 }}>Bank Name</td><td style={{ padding: 0 }}>: <span className="t-strong">{doc.bank.name}</span></td></tr>
                    <tr><td style={{ padding: 0 }}>A/c No.</td><td style={{ padding: 0 }}>: <span className="t-strong">{doc.bank.account}</span></td></tr>
                    <tr><td style={{ padding: 0 }}>Branch &amp; IFS Code</td><td style={{ padding: 0 }}>: <span className="t-strong">{[doc.bank.branch, doc.bank.ifsc].filter(Boolean).join(' & ')}</span></td></tr>
                  </tbody>
                </table>
              ) : <div style={{ minHeight: 30 }} />}
            </div>
            <div className="t-pad t-sign">
              <div className="t-strong">for {doc.seller.name}</div>
              <div>Authorised Signatory</div>
            </div>
          </div>
        </div>
      </div>
      <p className="t-foot">This is a Computer Generated Invoice</p>
      {doc.payment && (
        <p className="t-foot" style={{ fontSize: 11 }}>
          Received: ₹ {doc.payment.paid}{doc.payment.writtenOff && <> · Settled short: ₹ {doc.payment.writtenOff}</>} · Balance due: <strong>₹ {doc.payment.balance}</strong>
        </p>
      )}
    </div>
  );
}
