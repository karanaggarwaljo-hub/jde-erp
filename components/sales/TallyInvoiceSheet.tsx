/**
 * A sales invoice as a GST Tax Invoice (lib/tally-invoice.ts builds what goes in it): the letterhead
 * across the top, Bill To / Ship To beside the invoice details, the goods, the tax and grand total,
 * the HSN summary, and the signatory. Black on white in every theme: it is a paper document, and
 * what is on screen is what prints. lib/tally-invoice-pdf.ts draws the same for the saved PDF.
 */

import type { Party, TallyInvoice } from '@/lib/tally-invoice';

const CSS = `
.gst { position:relative; background:#fff; color:#000; font-family: Arial, Helvetica, sans-serif; font-size:11px; line-height:1.4; max-width:800px; margin:0 auto; }
.gst * { box-sizing:border-box; }
.gst .g-top { text-align:center; margin-bottom:4px; }
.gst .g-top b { font-size:13px; letter-spacing:.3px; }
.gst .g-top span { display:block; font-size:9px; }
.gst .g-box { border:1px solid #000; }
.gst .g-head { text-align:center; padding:8px 8px 6px; border-bottom:1px solid #000; }
.gst .g-co { font-size:20px; font-weight:700; letter-spacing:1px; text-transform:uppercase; }
.gst .g-row { display:flex; border-bottom:1px solid #000; }
.gst .g-col { flex:1 1 0; min-width:0; padding:5px 7px; }
.gst .g-col + .g-col { border-left:1px solid #000; }
.gst .g-cap { font-size:9px; text-transform:uppercase; letter-spacing:.5px; color:#333; margin-bottom:2px; }
.gst .g-name { font-weight:700; font-size:12px; }
.gst .g-kv { display:grid; grid-template-columns:auto 1fr; column-gap:6px; }
.gst .g-kv dt { color:#333; white-space:nowrap; }
.gst .g-kv dd { margin:0; font-weight:700; min-height:15px; }
.gst table { width:100%; border-collapse:collapse; }
.gst th, .gst td { padding:4px 6px; vertical-align:top; }
.gst .g-items thead th { background:#f0f0f0; border-bottom:1px solid #000; font-size:10px; text-align:center; font-weight:700; }
.gst .g-items th + th, .gst .g-items td + td { border-left:1px solid #000; }
.gst .g-items .g-pad td { height:22px; }
.gst .g-items tr.g-total td { border-top:1px solid #000; font-weight:700; }
.gst .r { text-align:right; white-space:nowrap; }
.gst .c { text-align:center; }
.gst .g-sub { font-size:9.5px; color:#333; }
.gst .g-charges td { padding:2px 6px; }
.gst .g-grand { display:flex; justify-content:flex-end; align-items:center; gap:24px; padding:6px 7px; background:#f0f0f0; border-bottom:1px solid #000; font-weight:700; font-size:13px; }
.gst .g-tax th, .gst .g-tax td { border:1px solid #000; font-size:10px; }
.gst .g-tax thead th { background:#f0f0f0; text-align:center; }
.gst .g-tax tr > :first-child { border-left:0; }
.gst .g-tax tr > :last-child { border-right:0; }
.gst .g-tax thead tr:first-child th { border-top:0; }
.gst .g-sign { display:flex; flex-direction:column; justify-content:space-between; min-height:86px; text-align:right; }
.gst .g-foot { text-align:center; font-size:9.5px; margin-top:4px; }
.gst .g-void { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none; }
.gst .g-void span { transform:rotate(-28deg); font-size:84px; font-weight:800; letter-spacing:6px; color:rgba(200,0,0,.28); border:6px solid rgba(200,0,0,.28); padding:4px 24px; }
.gst .g-void-note { text-align:center; color:#c00; font-weight:700; margin:2px 0 4px; }
@media print { .gst { max-width:none; } .gst .g-items thead th, .gst .g-grand, .gst .g-tax thead th { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
`;

function PartyBox({ caption, party }: { caption: string; party: Party }) {
  return (
    <div className="g-col">
      <div className="g-cap">{caption}</div>
      <div className="g-name">{party.name}</div>
      {party.lines.map((line) => <div key={line}>{line}</div>)}
      <dl className="g-kv" style={{ marginTop: 4 }}>
        {party.phone && <><dt>Contact No.</dt><dd style={{ fontWeight: 400 }}>{party.phone}</dd></>}
        {party.gstin && <><dt>GSTIN/UIN</dt><dd>{party.gstin}</dd></>}
        {party.state && <><dt>Place of Supply</dt><dd style={{ fontWeight: 400 }}>{party.state}</dd></>}
        {party.stateCode && <><dt>State Code</dt><dd style={{ fontWeight: 400 }}>{party.stateCode}</dd></>}
      </dl>
    </div>
  );
}

export default function TallyInvoiceSheet({ doc }: { doc: TallyInvoice }) {
  const intra = !doc.interState;
  const showDiscount = doc.items.some((item) => item.discount);
  const columns = showDiscount ? 8 : 7;
  return (
    <div className="gst">
      <style>{CSS}</style>
      <div className="g-top"><b>{doc.title}</b><span>{doc.subtitle}</span></div>
      {doc.cancelled && (
        <>
          <div className="g-void" aria-hidden="true"><span>CANCELLED</span></div>
          <p className="g-void-note">CANCELLED{doc.cancelled.on ? ` on ${doc.cancelled.on}` : ''}{doc.cancelled.reason ? ` — ${doc.cancelled.reason}` : ''}</p>
        </>
      )}
      <div className="g-box">
        <div className="g-head">
          <div className="g-co">{doc.seller.name}</div>
          {doc.seller.lines.length > 0 && <div>{doc.seller.lines.join(', ')}</div>}
          {doc.letterhead.contact && <div>{doc.letterhead.contact}</div>}
          {doc.letterhead.gstin && <div style={{ fontWeight: 700, marginTop: 2 }}>{doc.letterhead.gstin}</div>}
          {doc.letterhead.registrations && <div>{doc.letterhead.registrations}</div>}
        </div>

        <div className="g-row">
          <PartyBox caption="Bill To" party={doc.buyer} />
          <PartyBox caption="Ship To" party={doc.buyer} />
          <div className="g-col">
            <dl className="g-kv">
              {doc.details.map(([label, value]) => (
                <div key={label} style={{ display: 'contents' }}><dt>{label}</dt><dd>{value ? `: ${value}` : ':'}</dd></div>
              ))}
            </dl>
          </div>
        </div>

        <table className="g-items">
          <thead>
            <tr>
              <th style={{ width: 34 }}>Sr. No.</th>
              <th>Description of Goods</th>
              <th style={{ width: 72 }}>HSN</th>
              <th style={{ width: 46 }}>Qty</th>
              <th style={{ width: 76 }}>Price</th>
              <th style={{ width: 40 }}>Unit</th>
              {showDiscount && <th style={{ width: 44 }}>Disc. %</th>}
              <th style={{ width: 92 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.items.map((item) => (
              <tr key={item.sl}>
                <td className="c">{item.sl}</td>
                <td><b>{item.description}</b>{item.partNumber && <div className="g-sub">Part No. {item.partNumber}</div>}</td>
                <td className="c">{item.hsn}</td>
                <td className="r">{item.qty}</td>
                <td className="r">{item.rate}</td>
                <td className="c">{item.unit}</td>
                {showDiscount && <td className="r">{item.discount}</td>}
                <td className="r">{item.amount}</td>
              </tr>
            ))}
            {doc.emptyNote && <tr><td /><td colSpan={columns - 2}><em>{doc.emptyNote}</em></td><td /></tr>}
            <tr className="g-pad">{Array.from({ length: columns }, (_, index) => <td key={index} />)}</tr>
            <tr className="g-total">
              <td /><td className="r">Total</td><td /><td className="r">{doc.totalQty}</td><td /><td />{showDiscount && <td />}<td className="r">{doc.itemsTotal}</td>
            </tr>
          </tbody>
        </table>

        <div className="g-row" style={{ borderTop: '1px solid #000' }}>
          <div className="g-col" style={{ flex: '1.3 1 0' }}>
            <div className="g-cap">Amount in words</div>
            <div style={{ fontWeight: 700 }}>{doc.amountInWords}</div>
          </div>
          <div className="g-col" style={{ padding: '3px 0' }}>
            <table className="g-charges">
              <tbody>
                {doc.charges.map((charge) => (
                  <tr key={charge.label}>
                    <td>{charge.label}{charge.rate ? ` @ ${charge.rate}` : ''}</td>
                    <td className="r">{charge.amount}</td>
                  </tr>
                ))}
                {doc.charges.length === 0 && <tr><td>No tax charged</td><td /></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="g-grand"><span>GRAND TOTAL</span><span>₹ {doc.total}</span></div>

        <table className="g-tax">
          <thead>
            <tr>
              <th rowSpan={2}>HSN/SAC</th>
              <th rowSpan={2}>Taxable Value</th>
              {intra ? <><th colSpan={2}>Central Tax</th><th colSpan={2}>{doc.localTaxColumn}</th></> : <th colSpan={2}>Integrated Tax</th>}
              <th rowSpan={2}>Total Tax Amount</th>
            </tr>
            <tr><th>Rate</th><th>Amount</th>{intra && <><th>Rate</th><th>Amount</th></>}</tr>
          </thead>
          <tbody>
            {[...doc.taxRows, doc.taxTotal].map((row, index) => {
              const isTotal = index === doc.taxRows.length;
              return (
                <tr key={`${row.hsn}-${index}`} style={isTotal ? { fontWeight: 700 } : undefined}>
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
        <div style={{ padding: '4px 7px', borderBottom: '1px solid #000' }}>
          Tax Amount (in words): <b>{doc.taxInWords}</b>{doc.inclusive && <span className="g-sub"> · Prices include GST.</span>}
        </div>

        <div className="g-row" style={{ borderBottom: 0 }}>
          <div className="g-col" style={{ flex: '1.3 1 0' }}>
            <div className="g-cap">Terms &amp; Declaration</div>
            <div>{doc.declaration}</div>
          </div>
          <div className="g-col g-sign">
            <b>For, {doc.seller.name.toUpperCase()}</b>
            <span>Authorised Signatory</span>
          </div>
        </div>
      </div>
      <p className="g-foot">This is a computer generated invoice.</p>
      {doc.payment && (
        <p className="g-foot" style={{ fontSize: 10.5 }}>
          Received: ₹ {doc.payment.paid}{doc.payment.writtenOff && <> · Settled short: ₹ {doc.payment.writtenOff}</>} · Balance due: <b>₹ {doc.payment.balance}</b>
        </p>
      )}
    </div>
  );
}
