/**
 * A sales invoice as a GST Tax Invoice (lib/tally-invoice.ts builds what goes in it): the letterhead
 * across the top, Bill To / Ship To beside the invoice details, the goods, the tax and grand total,
 * the HSN summary, and the signatory. Black on white in every theme: it is a paper document, and
 * what is on screen is what prints. lib/tally-invoice-pdf.ts draws the same for the saved PDF.
 *
 * A full A4 sheet, as Tally prints it (the owner asked for a full-page A4 bill): the empty goods
 * columns run down the page so the signatory sits at its foot. On screen the sheet keeps the A4
 * shape; a longer bill simply grows and prints over more pages.
 */

import type { Party, TallyInvoice } from '@/lib/tally-invoice';

const CSS = `
.gst { position:relative; background:#fff; color:#000; font-family: Arial, Helvetica, sans-serif; font-size:11px; line-height:1.4; max-width:800px; min-width:640px; margin:0 auto;
  display:flex; flex-direction:column; aspect-ratio:210 / 297; }
.gst * { box-sizing:border-box; }
.gst .g-top { text-align:center; margin-bottom:4px; }
.gst .g-top b { font-size:13px; letter-spacing:.3px; }
.gst .g-top span { display:block; font-size:9px; }
.gst .g-box { border:1px solid #000; flex:1 1 auto; display:flex; flex-direction:column; }
.gst .g-box > * { flex:0 0 auto; }
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
.gst .g-items { table-layout:fixed; }
.gst th, .gst td { padding:4px 6px; vertical-align:top; }
.gst .g-items thead th { background:#f0f0f0; border-bottom:1px solid #000; font-size:10px; text-align:center; font-weight:700; }
.gst .g-items th + th, .gst .g-items td + td { border-left:1px solid #000; }
/* The empty space under the goods, carrying their column lines down to the totals: it takes
   whatever height the A4 sheet has left. Its widths are the goods columns' own. */
.gst .g-box > .g-fill { flex:1 1 auto; display:flex; min-height:22px; }
.gst .g-fill > span { display:block; }
.gst .g-fill > span + span { border-left:1px solid #000; }
.gst .g-items tr.g-total td { border-top:1px solid #000; font-weight:700; }
.gst .r { text-align:right; white-space:nowrap; }
.gst .c { text-align:center; }
.gst .g-sub { font-size:9.5px; color:#333; }
.gst .g-charges td { padding:2px 6px; }
.gst .g-grand { display:flex; justify-content:flex-end; align-items:center; gap:24px; padding:6px 7px; background:#f0f0f0; border-bottom:1px solid #000; font-weight:700; font-size:13px; }
.gst .g-sign { display:flex; flex-direction:column; justify-content:space-between; min-height:86px; text-align:right; }
.gst .g-foot { text-align:center; font-size:9.5px; margin-top:4px; }
.gst .g-void { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none; }
.gst .g-void span { transform:rotate(-28deg); font-size:84px; font-weight:800; letter-spacing:6px; color:rgba(200,0,0,.28); border:6px solid rgba(200,0,0,.28); padding:4px 24px; }
.gst .g-void-note { text-align:center; color:#c00; font-weight:700; margin:2px 0 4px; }
@page { size:A4; margin:10mm; }
@media print { .gst { max-width:none; aspect-ratio:auto; min-height:272mm; } .gst .g-items thead th, .gst .g-grand { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
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
  const showDiscount = doc.items.some((item) => item.discount);
  // The goods columns' widths; the description takes what is left. Shared by the goods, the empty
  // space beneath them and the total line, so their column lines meet.
  const widths: Array<number | null> = [34, null, 72, 46, 76, 40, ...(showDiscount ? [44] : []), 92];
  const columns = widths.length;
  const colgroup = <colgroup>{widths.map((width, index) => <col key={index} style={width ? { width } : undefined} />)}</colgroup>;
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
          {colgroup}
          <thead>
            <tr>
              <th>Sr. No.</th>
              <th>Description of Goods</th>
              <th>HSN</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Unit</th>
              {showDiscount && <th>Disc. %</th>}
              <th>Amount</th>
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
          </tbody>
        </table>
        <div className="g-fill" aria-hidden="true">
          {widths.map((width, index) => <span key={index} style={width ? { flex: `0 0 ${width}px` } : { flex: '1 1 0', minWidth: 0 }} />)}
        </div>
        <table className="g-items">
          {colgroup}
          <tbody>
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
