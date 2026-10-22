/**
 * Draws a GST Tax Invoice (lib/tally-invoice.ts) as a PDF: the same boxes, in the
 * same order, as the printed page (components/sales/TallyInvoiceSheet.tsx).
 *
 * Built-in fonts only, nothing embedded, so each invoice stays a few kilobytes (see
 * pdfSafe below: the rupee sign is written "Rs."). A long bill carries its goods on to
 * further pages, each with the column headings again; the summary boxes follow the last goods.
 * The bill fills the whole A4 sheet, as Tally prints it: the goods columns run down the page so the
 * signatory sits at its foot (the owner asked for a full-page A4 bill).
 */

import { degrees, PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { TallyInvoice } from './tally-invoice';

const PAGE: [number, number] = [595.28, 841.89]; // A4
const LEFT = 28;
const RIGHT = PAGE[0] - 28;
const WIDTH = RIGHT - LEFT;
const TOP = PAGE[1] - 28;
const BOTTOM = 34;
const BLACK = rgb(0, 0, 0);
const GREY = rgb(0.35, 0.35, 0.35);
const RED = rgb(0.78, 0, 0);

/** Part of every saved PDF's fingerprint (lib/invoice-archive.ts): changing how the bill is drawn
 *  changes it, so PDFs saved in the old layout are drawn again the next time they are wanted. */
export const PDF_LAYOUT = 'a4-full-page-1';

// The extra characters the built-in fonts' WinAnsi encoding has beyond Latin-1.
const WIN_ANSI_EXTRA = new Set(Array.from('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'));
const REPLACE: Record<string, string> = { '₹': 'Rs.', '−': '-', ' ': ' ', ' ': ' ', '​': '' };

/** Text the built-in fonts can draw: anything they cannot becomes "?" instead of an error. */
export function pdfSafe(value: string): string {
  let out = '';
  for (const ch of String(value ?? '')) {
    if (REPLACE[ch] !== undefined) { out += REPLACE[ch]; continue; }
    const code = ch.codePointAt(0) ?? 63;
    if (code === 9 || code === 10 || code === 13) { out += ' '; continue; }
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255) || WIN_ANSI_EXTRA.has(ch)) out += ch;
    else out += '?';
  }
  return out;
}

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont; boldItalic: PDFFont };

function wrap(value: string, font: PDFFont, size: number, width: number): string[] {
  const words = pdfSafe(value).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) { current = candidate; continue; }
    if (current) lines.push(current);
    let piece = '';
    for (const ch of word) {
      if (font.widthOfTextAtSize(piece + ch, size) <= width) piece += ch;
      else { lines.push(piece); piece = ch; }
    }
    current = piece;
  }
  if (current) lines.push(current);
  return lines;
}

const SHADE = rgb(0.94, 0.94, 0.94);

type Column = { label: string; width: number; align: 'left' | 'right' | 'center' };

/** The goods columns; the description takes whatever width the others leave. */
function goodsColumns(showDiscount: boolean): { columns: Column[]; x: number[] } {
  const fixed: Column[] = [
    { label: 'Sr. No.', width: 30, align: 'center' },
    { label: 'Description of Goods', width: 0, align: 'left' },
    { label: 'HSN', width: 58, align: 'center' },
    { label: 'Qty', width: 40, align: 'right' },
    { label: 'Price', width: 64, align: 'right' },
    { label: 'Unit', width: 32, align: 'center' },
    ...(showDiscount ? [{ label: 'Disc. %', width: 38, align: 'right' as const }] : []),
    { label: 'Amount', width: 78, align: 'right' },
  ];
  const used = fixed.reduce((sum, column) => sum + column.width, 0);
  const columns = fixed.map((column) => (column.width ? column : { ...column, width: WIDTH - used }));
  const x: number[] = [];
  let at = LEFT;
  for (const column of columns) { x.push(at); at += column.width; }
  return { columns, x };
}

export async function renderTallyInvoicePdf(doc: TallyInvoice): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(`Tax Invoice ${doc.details[0]?.[1] ?? ''}`));
  pdf.setAuthor(pdfSafe(doc.seller.name));
  pdf.setProducer('JDE ERP');
  pdf.setCreator('JDE ERP');
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };

  let page: PDFPage = pdf.addPage(PAGE);
  let y = TOP;

  const text = (value: string, x: number, at: number, size = 8, font = fonts.regular, color = BLACK) => {
    page.drawText(pdfSafe(value), { x, y: at, size, font, color });
  };
  const right = (value: string, x: number, at: number, size = 8, font = fonts.regular) => {
    const safe = pdfSafe(value);
    page.drawText(safe, { x: x - font.widthOfTextAtSize(safe, size), y: at, size, font, color: BLACK });
  };
  const center = (value: string, x: number, width: number, at: number, size = 8, font = fonts.regular) => {
    const safe = pdfSafe(value);
    page.drawText(safe, { x: x + (width - font.widthOfTextAtSize(safe, size)) / 2, y: at, size, font, color: BLACK });
  };
  const line = (x1: number, y1: number, x2: number, y2: number) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.6, color: BLACK });
  const box = (x: number, top: number, width: number, height: number, fill?: typeof SHADE) =>
    page.drawRectangle({ x, y: top - height, width, height, borderColor: BLACK, borderWidth: 0.6, color: fill });

  // ── Title and letterhead ─────────────────────────────────────────────────────────────────
  center(doc.title, LEFT, WIDTH, y - 10, 10, fonts.bold);
  center(doc.subtitle, LEFT, WIDTH, y - 19, 6.5);
  y -= 24;
  if (doc.cancelled) {
    const note = pdfSafe(`CANCELLED${doc.cancelled.on ? ` on ${doc.cancelled.on}` : ''}${doc.cancelled.reason ? ` - ${doc.cancelled.reason}` : ''}`).slice(0, 120);
    page.drawText(note, { x: LEFT + (WIDTH - fonts.bold.widthOfTextAtSize(note, 8.5)) / 2, y: y - 6, size: 8.5, font: fonts.bold, color: RED });
    y -= 12;
  }
  const address = doc.seller.lines.length ? wrap(doc.seller.lines.join(', '), fonts.regular, 8, WIDTH - 20) : [];
  const contact = doc.letterhead.contact ? wrap(doc.letterhead.contact, fonts.regular, 8, WIDTH - 20) : [];
  const gstLine = doc.letterhead.gstin;
  const registrations = doc.letterhead.registrations;
  const headHeight = 30 + address.length * 10 + contact.length * 10 + (gstLine ? 11 : 0) + (registrations ? 10 : 0);
  box(LEFT, y, WIDTH, headHeight);
  let at = y - 20;
  center(doc.seller.name.toUpperCase(), LEFT, WIDTH, at, 16, fonts.bold);
  at -= 13;
  for (const piece of address) { center(piece, LEFT, WIDTH, at, 8); at -= 10; }
  for (const piece of contact) { center(piece, LEFT, WIDTH, at, 8); at -= 10; }
  if (gstLine) { center(gstLine, LEFT, WIDTH, at - 1, 8, fonts.bold); at -= 11; }
  if (registrations) center(registrations, LEFT, WIDTH, at - 1, 8);
  y -= headHeight;

  // ── Bill To | Ship To | invoice details ──────────────────────────────────────────────────
  const third = WIDTH / 3;
  const partyLines = (party: TallyInvoice['buyer']): Array<[string, PDFFont, number]> => {
    const out: Array<[string, PDFFont, number]> = [[party.name, fonts.bold, 9]];
    for (const addressLine of party.lines) for (const piece of wrap(addressLine, fonts.regular, 8, third - 12)) out.push([piece, fonts.regular, 8]);
    if (party.phone) out.push([`Contact No.  ${party.phone}`, fonts.regular, 8]);
    if (party.gstin) out.push([`GSTIN/UIN  ${party.gstin}`, fonts.bold, 8]);
    if (party.state) out.push([`Place of Supply  ${party.state}`, fonts.regular, 8]);
    if (party.stateCode) out.push([`State Code  ${party.stateCode}`, fonts.regular, 8]);
    return out;
  };
  const buyer = partyLines(doc.buyer);
  const detailLabelWidth = Math.max(...doc.details.map(([label]) => fonts.regular.widthOfTextAtSize(label, 8))) + 6;
  const partyHeight = Math.max(18 + buyer.length * 10.5, 10 + doc.details.length * 11.5);
  box(LEFT, y, WIDTH, partyHeight);
  line(LEFT + third, y, LEFT + third, y - partyHeight);
  line(LEFT + 2 * third, y, LEFT + 2 * third, y - partyHeight);
  for (const [index, caption] of ['BILL TO', 'SHIP TO'].entries()) {
    const x = LEFT + index * third + 5;
    text(caption, x, y - 9, 6.5, fonts.bold, GREY);
    let lineAt = y - 20;
    for (const [value, font, size] of buyer) { text(wrap(value, font, size, third - 10)[0], x, lineAt, size, font); lineAt -= 10.5; }
  }
  at = y - 11;
  for (const [label, value] of doc.details) {
    const x = LEFT + 2 * third + 5;
    text(label, x, at, 8, fonts.regular, GREY);
    text(`: ${value}`, x + detailLabelWidth, at, 8, fonts.bold);
    at -= 11.5;
  }
  y -= partyHeight;

  // ── Goods ────────────────────────────────────────────────────────────────────────────────
  const showDiscount = doc.items.some((item) => item.discount);
  const { columns, x: colX } = goodsColumns(showDiscount);
  const amountCol = columns.length - 1;
  // Everything under the goods, measured first: it must fit after the goods on their last page,
  // and the goods stretch down to meet it so the bill ends at the foot of the sheet.
  const split = LEFT + WIDTH * 0.565;
  const words = wrap(doc.amountInWords, fonts.bold, 8.5, split - LEFT - 10);
  const charges = doc.charges.length ? doc.charges : [{ label: 'No tax charged', rate: '', amount: '' }];
  const sumHeight = Math.max(18 + words.length * 11, 8 + charges.length * 12);
  const taxHead = 24;
  const taxRows = [...doc.taxRows, doc.taxTotal];
  const taxHeight = taxHead + taxRows.length * 12;
  const declaration = wrap(doc.declaration, fonts.regular, 7.5, split - LEFT - 10);
  const footHeight = Math.max(80, 22 + declaration.length * 9);
  const footNote = doc.payment ? 26 : 14;
  const after = 16 + sumHeight + 20 + taxHeight + 16 + footHeight + footNote;

  let tableTop = y;
  const headings = () => {
    box(LEFT, y, WIDTH, 16, SHADE);
    columns.forEach((column, index) => center(column.label, colX[index], column.width, y - 11, 7.5, fonts.bold));
    y -= 16;
    tableTop = y;
  };
  const closeColumns = (bottom: number) => {
    line(LEFT, tableTop, LEFT, bottom);
    line(RIGHT, tableTop, RIGHT, bottom);
    for (let index = 1; index < columns.length; index += 1) line(colX[index], tableTop + 16, colX[index], bottom);
  };
  const newPage = () => {
    closeColumns(y);
    line(LEFT, y, RIGHT, y);
    right('continued ...', RIGHT, y - 12, 8, fonts.italic);
    page = pdf.addPage(PAGE);
    y = TOP;
    center(`${doc.title} ${doc.details[0]?.[1] ?? ''} (continued)`, LEFT, WIDTH, y - 10, 9, fonts.bold);
    y -= 18;
    headings();
  };
  headings();
  const cell = (index: number, value: string, at2: number, font = fonts.regular, size = 8) => {
    const column = columns[index];
    if (column.align === 'right') right(value, colX[index] + column.width - 4, at2, size, font);
    else if (column.align === 'center') center(value, colX[index], column.width, at2, size, font);
    else text(value, colX[index] + 4, at2, size, font);
  };

  for (const item of doc.items) {
    const description = wrap(item.description, fonts.bold, 8, columns[1].width - 8);
    const partLine = item.partNumber ? wrap(`Part No. ${item.partNumber}`, fonts.regular, 7, columns[1].width - 8) : [];
    const height = (description.length + partLine.length) * 10 + 5;
    if (y - height < BOTTOM + 20) newPage();
    at = y - 10;
    cell(0, String(item.sl), at);
    cell(2, item.hsn, at);
    cell(3, item.qty, at);
    cell(4, item.rate, at);
    cell(5, item.unit, at);
    if (showDiscount) cell(6, item.discount, at);
    cell(amountCol, item.amount, at);
    for (const piece of description) { text(piece, colX[1] + 4, at, 8, fonts.bold); at -= 10; }
    for (const piece of partLine) { text(piece, colX[1] + 4, at, 7, fonts.regular, GREY); at -= 10; }
    y -= height;
  }
  if (doc.emptyNote) {
    for (const piece of wrap(doc.emptyNote, fonts.italic, 8, columns[1].width - 8)) { text(piece, colX[1] + 4, y - 10, 8, fonts.italic); y -= 10; }
  }
  y -= 10;
  if (y - after < BOTTOM) newPage();
  // Full page: the empty goods columns run down to the summary, which ends at the foot of the sheet.
  y = BOTTOM + after;
  line(LEFT, y, RIGHT, y);
  right('Total', colX[2] - 4, y - 11, 8, fonts.bold);
  cell(3, doc.totalQty, y - 11, fonts.bold);
  cell(amountCol, doc.itemsTotal, y - 11, fonts.bold);
  y -= 16;
  closeColumns(y);
  line(LEFT, y, RIGHT, y);

  // ── Amount in words | tax and deductions ────────────────────────────────────────────────
  box(LEFT, y, WIDTH, sumHeight);
  line(split, y, split, y - sumHeight);
  text('AMOUNT IN WORDS', LEFT + 5, y - 9, 6.5, fonts.bold, GREY);
  at = y - 20;
  for (const piece of words) { text(piece, LEFT + 5, at, 8.5, fonts.bold); at -= 11; }
  at = y - 11;
  for (const charge of charges) {
    text(`${charge.label}${charge.rate ? ` @ ${charge.rate}` : ''}`, split + 5, at, 8);
    right(charge.amount, RIGHT - 5, at, 8);
    at -= 12;
  }
  y -= sumHeight;

  // Grand total, shaded.
  box(LEFT, y, WIDTH, 20, SHADE);
  right(`Rs. ${doc.total}`, RIGHT - 5, y - 14, 11, fonts.bold);
  right('GRAND TOTAL', RIGHT - 5 - fonts.bold.widthOfTextAtSize(pdfSafe(`Rs. ${doc.total}`), 11) - 24, y - 14, 10, fonts.bold);
  y -= 20;

  // ── HSN-wise tax summary ─────────────────────────────────────────────────────────────────
  const intra = !doc.interState;
  const taxCols = intra
    ? [{ w: 0.18, label: 'HSN/SAC' }, { w: 0.18, label: 'Taxable Value' }, { w: 0.09, label: 'Rate', group: 'Central Tax' }, { w: 0.13, label: 'Amount', group: 'Central Tax' }, { w: 0.09, label: 'Rate', group: doc.localTaxColumn }, { w: 0.13, label: 'Amount', group: doc.localTaxColumn }, { w: 0.2, label: 'Total Tax Amount' }]
    : [{ w: 0.22, label: 'HSN/SAC' }, { w: 0.24, label: 'Taxable Value' }, { w: 0.12, label: 'Rate', group: 'Integrated Tax' }, { w: 0.18, label: 'Amount', group: 'Integrated Tax' }, { w: 0.24, label: 'Total Tax Amount' }];
  const taxX: number[] = [];
  {
    let x = LEFT;
    for (const column of taxCols) { taxX.push(x); x += column.w * WIDTH; }
  }
  box(LEFT, y, WIDTH, taxHead, SHADE);
  box(LEFT, y, WIDTH, taxHeight);
  taxCols.forEach((column, index) => {
    const x = taxX[index];
    const width = column.w * WIDTH;
    if (index > 0) line(x, y - (column.group && taxCols[index - 1].group === column.group ? 12 : 0), x, y - taxHeight);
    if (column.group) {
      if (taxCols[index - 1]?.group !== column.group) {
        center(column.group, x, width + taxCols[index + 1].w * WIDTH, y - 9, 7, fonts.bold);
        line(x, y - 12, x + width + taxCols[index + 1].w * WIDTH, y - 12);
      }
      center(column.label, x, width, y - 21, 7, fonts.bold);
    } else {
      center(column.label, x, width, y - 15, 7, fonts.bold);
    }
  });
  line(LEFT, y - taxHead, RIGHT, y - taxHead);
  at = y - taxHead - 9;
  taxRows.forEach((row, index) => {
    const isTotal = index === taxRows.length - 1;
    const font = isTotal ? fonts.bold : fonts.regular;
    const values = intra
      ? [row.hsn, row.taxable, row.cgstRate, row.cgst, row.sgstRate, row.sgst, row.totalTax]
      : [row.hsn, row.taxable, row.igstRate, row.igst, row.totalTax];
    values.forEach((value, column) => {
      const x = taxX[column];
      const width = taxCols[column].w * WIDTH;
      if (column === 0 && !isTotal) text(value, x + 4, at, 7.5, font);
      else right(value, x + width - 4, at, 7.5, font);
    });
    if (isTotal) line(LEFT, at + 9, RIGHT, at + 9);
    at -= 12;
  });
  y -= taxHeight;

  const taxWords = `Tax Amount (in words): ${doc.taxInWords}${doc.inclusive ? '  (prices include GST)' : ''}`;
  box(LEFT, y, WIDTH, 16);
  text(wrap(taxWords, fonts.regular, 7.5, WIDTH - 10)[0], LEFT + 5, y - 11, 7.5);
  y -= 16;

  // ── Declaration | signatory ──────────────────────────────────────────────────────────────
  box(LEFT, y, WIDTH, footHeight);
  line(split, y, split, y - footHeight);
  text('TERMS & DECLARATION', LEFT + 5, y - 9, 6.5, fonts.bold, GREY);
  at = y - 20;
  for (const piece of declaration) { text(piece, LEFT + 5, at, 7.5); at -= 9; }
  right(`For, ${doc.seller.name.toUpperCase()}`, RIGHT - 5, y - 13, 8.5, fonts.bold);
  right('Authorised Signatory', RIGHT - 5, y - footHeight + 8, 8);
  y -= footHeight;

  center('This is a computer generated invoice.', LEFT, WIDTH, y - 11, 7);
  if (doc.payment) {
    center(`Received: Rs. ${doc.payment.paid}${doc.payment.writtenOff ? `  |  Settled short: Rs. ${doc.payment.writtenOff}` : ''}  |  Balance due: Rs. ${doc.payment.balance}`, LEFT, WIDTH, y - 22, 7.5, fonts.bold);
  }

  const pages = pdf.getPages();
  // A cancelled invoice is stamped across every page.
  if (doc.cancelled) {
    for (const each of pages) {
      const size = 78;
      const width = fonts.bold.widthOfTextAtSize('CANCELLED', size);
      each.drawText('CANCELLED', { x: PAGE[0] / 2 - (width / 2) * Math.cos(Math.PI / 6.5), y: PAGE[1] / 2 - (width / 2) * Math.sin(Math.PI / 6.5), size, font: fonts.bold, color: RED, opacity: 0.22, rotate: degrees(180 / 6.5) });
    }
  }
  if (pages.length > 1) {
    pages.forEach((each, index) => {
      const label = pdfSafe(`Page ${index + 1} of ${pages.length}`);
      each.drawText(label, { x: RIGHT - fonts.regular.widthOfTextAtSize(label, 7), y: 16, size: 7, font: fonts.regular, color: GREY });
    });
  }

  return pdf.save();
}
