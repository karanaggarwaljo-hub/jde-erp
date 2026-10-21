/**
 * Draws a Tally-style GST Tax Invoice (lib/tally-invoice.ts) as a PDF: the same boxes, in the
 * same order, as the printed page (components/sales/TallyInvoiceSheet.tsx).
 *
 * Built-in fonts only, nothing embedded, so each invoice stays a few kilobytes (see
 * pdfSafe below: the rupee sign is written "Rs."). A long bill carries its goods on to
 * further pages, each with the column headings again; the summary boxes follow the last goods.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { TallyInvoice } from './tally-invoice';

const PAGE: [number, number] = [595.28, 841.89]; // A4
const LEFT = 28;
const RIGHT = PAGE[0] - 28;
const WIDTH = RIGHT - LEFT;
const MID = LEFT + WIDTH / 2;
const TOP = PAGE[1] - 28;
const BOTTOM = 34;
const BLACK = rgb(0, 0, 0);
const GREY = rgb(0.35, 0.35, 0.35);

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

// Goods table columns: x positions from the left edge of the box.
const COLUMNS = [
  { key: 'sl', label: 'Sl No.', width: 26, align: 'center' },
  { key: 'description', label: 'Description of Goods', width: 0, align: 'left' },
  { key: 'hsn', label: 'HSN/SAC', width: 58, align: 'center' },
  { key: 'qty', label: 'Quantity', width: 54, align: 'right' },
  { key: 'rate', label: 'Rate', width: 62, align: 'right' },
  { key: 'per', label: 'per', width: 28, align: 'center' },
  { key: 'disc', label: 'Disc. %', width: 36, align: 'right' },
  { key: 'amount', label: 'Amount', width: 74, align: 'right' },
] as const;
const FIXED = COLUMNS.reduce((sum, column) => sum + column.width, 0);
const COL_X: number[] = [];
{
  let x = LEFT;
  for (const column of COLUMNS) {
    COL_X.push(x);
    x += column.width || WIDTH - FIXED;
  }
}
const colWidth = (index: number) => (COLUMNS[index].width || WIDTH - FIXED);

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
  const box = (x: number, top: number, width: number, height: number) => page.drawRectangle({ x, y: top - height, width, height, borderColor: BLACK, borderWidth: 0.6 });

  // Title
  center(doc.title, LEFT, WIDTH, y - 12, 12, fonts.bold);
  y -= 18;

  // ── Seller | details grid ─────────────────────────────────────────────────────────────────
  const sellerLines: Array<[string, PDFFont, number]> = [[doc.seller.name, fonts.bold, 10]];
  for (const addressLine of doc.seller.lines) for (const piece of wrap(addressLine, fonts.regular, 8, WIDTH / 2 - 12)) sellerLines.push([piece, fonts.regular, 8]);
  if (doc.seller.gstin) sellerLines.push([`GSTIN/UIN: ${doc.seller.gstin}`, fonts.regular, 8]);
  if (doc.seller.state) sellerLines.push([`State Name : ${doc.seller.state}, Code : ${doc.seller.stateCode}`, fonts.regular, 8]);
  if (doc.seller.phone) sellerLines.push([`Contact : ${doc.seller.phone}`, fonts.regular, 8]);
  if (doc.seller.email) sellerLines.push([`E-Mail : ${doc.seller.email}`, fonts.regular, 8]);
  const detailRows = Math.ceil(doc.details.length / 2);
  const detailHeight = 21;
  const headerHeight = Math.max(detailRows * detailHeight, sellerLines.length * 10.5 + 8);
  box(LEFT, y, WIDTH, headerHeight);
  line(MID, y, MID, y - headerHeight);
  let at = y - 12;
  for (const [value, font, size] of sellerLines) { text(value, LEFT + 5, at, size, font); at -= 10.5; }
  const rowHeight = headerHeight / detailRows;
  doc.details.forEach(([label, value], index) => {
    const row = Math.floor(index / 2);
    const x = index % 2 === 0 ? MID : MID + WIDTH / 4;
    const top = y - row * rowHeight;
    if (row > 0 && index % 2 === 0) line(MID, top, RIGHT, top);
    text(label, x + 4, top - 9, 7, fonts.regular, GREY);
    if (value) text(wrap(value, fonts.bold, 8, WIDTH / 4 - 8)[0], x + 4, top - 18, 8, fonts.bold);
  });
  line(MID + WIDTH / 4, y, MID + WIDTH / 4, y - headerHeight);
  y -= headerHeight;

  // ── Buyer | terms of delivery ─────────────────────────────────────────────────────────────
  const buyerLines: Array<[string, PDFFont, number, typeof GREY]> = [['Buyer (Bill to)', fonts.regular, 7, GREY], [doc.buyer.name, fonts.bold, 10, BLACK]];
  for (const addressLine of doc.buyer.lines) for (const piece of wrap(addressLine, fonts.regular, 8, WIDTH / 2 - 12)) buyerLines.push([piece, fonts.regular, 8, BLACK]);
  if (doc.buyer.gstin) buyerLines.push([`GSTIN/UIN : ${doc.buyer.gstin}`, fonts.regular, 8, BLACK]);
  if (doc.buyer.state) buyerLines.push([`State Name : ${doc.buyer.state}, Code : ${doc.buyer.stateCode}`, fonts.regular, 8, BLACK]);
  if (doc.buyer.phone) buyerLines.push([`Contact : ${doc.buyer.phone}`, fonts.regular, 8, BLACK]);
  const buyerHeight = Math.max(44, buyerLines.length * 10.5 + 6);
  box(LEFT, y, WIDTH, buyerHeight);
  line(MID, y, MID, y - buyerHeight);
  at = y - 10;
  for (const [value, font, size, color] of buyerLines) { text(value, LEFT + 5, at, size, font, color); at -= 10.5; }
  text('Terms of Delivery', MID + 4, y - 10, 7, fonts.regular, GREY);
  y -= buyerHeight;

  // ── Goods ────────────────────────────────────────────────────────────────────────────────
  // What must still fit after the goods on the page they end on: the total, the words, the tax
  // summary, and the bottom boxes.
  const summaryHeight = 16 + 30 + 26 + (doc.taxRows.length + 1) * 12 + 18 + 120 + 24;

  let tableTop = y;
  const headings = () => {
    box(LEFT, y, WIDTH, 16);
    COLUMNS.forEach((column, index) => center(column.label, COL_X[index], colWidth(index), y - 11, 7));
    y -= 16;
    tableTop = y;
  };
  const closeColumns = (bottom: number) => {
    line(LEFT, tableTop, LEFT, bottom);
    line(RIGHT, tableTop, RIGHT, bottom);
    for (let index = 1; index < COLUMNS.length; index += 1) line(COL_X[index], tableTop + 16, COL_X[index], bottom);
  };
  const newPage = () => {
    closeColumns(y);
    line(LEFT, y, RIGHT, y);
    right('continued ...', RIGHT, y - 12, 8, fonts.italic);
    page = pdf.addPage(PAGE);
    y = TOP;
    center(`${doc.title} (continued)`, LEFT, WIDTH, y - 12, 10, fonts.bold);
    y -= 18;
    headings();
  };
  headings();

  const cell = (index: number, value: string, at2: number, font = fonts.regular, size = 8) => {
    const column = COLUMNS[index];
    const x = COL_X[index];
    const width = colWidth(index);
    if (column.align === 'right') right(value, x + width - 4, at2, size, font);
    else if (column.align === 'center') center(value, x, width, at2, size, font);
    else text(value, x + 4, at2, size, font);
  };

  for (const item of doc.items) {
    const description = wrap(item.description, fonts.bold, 8, colWidth(1) - 8);
    const partLine = item.partNumber ? wrap(`Part No. ${item.partNumber}`, fonts.italic, 7, colWidth(1) - 8) : [];
    const height = (description.length + partLine.length) * 10 + 5;
    if (y - height < BOTTOM + 20) newPage();
    at = y - 10;
    cell(0, String(item.sl), at);
    cell(2, item.hsn, at);
    cell(3, `${item.qty} ${item.unit}`, at, fonts.bold);
    cell(4, item.rate, at);
    cell(5, item.unit, at);
    cell(6, item.discount, at);
    cell(7, item.amount, at, fonts.bold);
    for (const piece of description) { text(piece, COL_X[1] + 4, at, 8, fonts.bold); at -= 10; }
    for (const piece of partLine) { text(piece, COL_X[1] + 4, at, 7, fonts.italic); at -= 10; }
    y -= height;
  }
  if (doc.emptyNote) {
    for (const piece of wrap(doc.emptyNote, fonts.italic, 8, colWidth(1) - 8)) { text(piece, COL_X[1] + 4, y - 10, 8, fonts.italic); y -= 10; }
  }
  y -= 8;
  const chargesHeight = doc.charges.length * 13;
  if (y - chargesHeight - summaryHeight < BOTTOM) newPage();
  for (const charge of doc.charges) {
    right(charge.label, COL_X[2] - 4, y - 10, 8, fonts.boldItalic);
    cell(4, charge.rate, y - 10);
    cell(7, charge.amount, y - 10, fonts.bold);
    y -= 13;
  }
  y -= 4;
  // Total row
  line(LEFT, y, RIGHT, y);
  right('Total', COL_X[2] - 4, y - 11, 8);
  cell(3, doc.totalQty, y - 11, fonts.bold);
  cell(7, `Rs. ${doc.total}`, y - 11, fonts.bold, 9);
  y -= 16;
  closeColumns(y);
  line(LEFT, y, RIGHT, y);

  // ── Amount in words ──────────────────────────────────────────────────────────────────────
  const words = wrap(doc.amountInWords, fonts.bold, 9, WIDTH - 10);
  const wordsHeight = 14 + words.length * 11;
  box(LEFT, y, WIDTH, wordsHeight);
  text('Amount Chargeable (in words)', LEFT + 5, y - 9, 7, fonts.regular, GREY);
  right('E. & O.E', RIGHT - 5, y - 9, 7, fonts.italic);
  at = y - 20;
  for (const piece of words) { text(piece, LEFT + 5, at, 9, fonts.bold); at -= 11; }
  y -= wordsHeight;

  // ── HSN-wise tax summary ─────────────────────────────────────────────────────────────────
  const intra = !doc.interState;
  const taxCols = intra
    ? [{ w: 0.18, label: 'HSN/SAC' }, { w: 0.18, label: 'Taxable Value' }, { w: 0.09, label: 'Rate', group: 'Central Tax' }, { w: 0.13, label: 'Amount', group: 'Central Tax' }, { w: 0.09, label: 'Rate', group: 'State Tax' }, { w: 0.13, label: 'Amount', group: 'State Tax' }, { w: 0.2, label: 'Total Tax Amount' }]
    : [{ w: 0.22, label: 'HSN/SAC' }, { w: 0.24, label: 'Taxable Value' }, { w: 0.12, label: 'Rate', group: 'Integrated Tax' }, { w: 0.18, label: 'Amount', group: 'Integrated Tax' }, { w: 0.24, label: 'Total Tax Amount' }];
  const taxX: number[] = [];
  {
    let x = LEFT;
    for (const column of taxCols) { taxX.push(x); x += column.w * WIDTH; }
  }
  const taxHead = 24;
  const taxRows = [...doc.taxRows, doc.taxTotal];
  const taxHeight = taxHead + taxRows.length * 12;
  box(LEFT, y, WIDTH, taxHeight);
  taxCols.forEach((column, index) => {
    const x = taxX[index];
    const width = column.w * WIDTH;
    if (index > 0) line(x, y - (column.group && taxCols[index - 1].group === column.group ? 12 : 0), x, y - taxHeight);
    if (column.group) {
      if (taxCols[index - 1]?.group !== column.group) {
        center(column.group, x, width + taxCols[index + 1].w * WIDTH, y - 9, 7);
        line(x, y - 12, x + width + taxCols[index + 1].w * WIDTH, y - 12);
      }
      center(column.label, x, width, y - 21, 7);
    } else {
      center(column.label, x, width, y - 15, 7);
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
      if (column === 0) {
        if (isTotal) right(value, x + width - 4, at, 7.5, font);
        else text(value, x + 4, at, 7.5, font);
      } else right(value, x + width - 4, at, 7.5, font);
    });
    if (isTotal) line(LEFT, at + 9, RIGHT, at + 9);
    at -= 12;
  });
  y -= taxHeight;

  // Tax in words
  const taxWordsHeight = doc.inclusive ? 26 : 16;
  box(LEFT, y, WIDTH, taxWordsHeight);
  text('Tax Amount (in words) :', LEFT + 5, y - 11, 7.5);
  text(wrap(doc.taxInWords, fonts.bold, 8, WIDTH - 110)[0], LEFT + 95, y - 11, 8, fonts.bold);
  if (doc.inclusive) text('Prices include GST.', LEFT + 5, y - 21, 7, fonts.italic);
  y -= taxWordsHeight;

  // ── PAN, declaration | bank, signature ───────────────────────────────────────────────────
  const declaration = wrap(doc.declaration, fonts.regular, 7.5, WIDTH / 2 - 12);
  const bottomHeight = Math.max(110, 40 + declaration.length * 9 + 26);
  box(LEFT, y, WIDTH, bottomHeight);
  line(MID, y, MID, y - bottomHeight);
  at = y - 11;
  if (doc.seller.pan) { text(`Company's PAN : ${doc.seller.pan}`, LEFT + 5, at, 8); }
  at -= 16;
  text('Declaration', LEFT + 5, at, 7.5, fonts.bold);
  at -= 10;
  for (const piece of declaration) { text(piece, LEFT + 5, at, 7.5); at -= 9; }
  text("Customer's Seal and Signature", LEFT + 5, y - bottomHeight + 8, 7.5);

  text("Company's Bank Details", MID + 5, y - 10, 7, fonts.regular, GREY);
  const bankTop = y - 21;
  if (doc.bank) {
    const rows: Array<[string, string]> = [
      ['Bank Name', doc.bank.name],
      ['A/c No.', doc.bank.account],
      ['Branch & IFS Code', [doc.bank.branch, doc.bank.ifsc].filter(Boolean).join(' & ')],
    ];
    rows.forEach(([label, value], index) => {
      text(label, MID + 5, bankTop - index * 10, 7.5);
      text(`: ${wrap(value, fonts.bold, 7.5, WIDTH / 2 - 95)[0]}`, MID + 80, bankTop - index * 10, 7.5, fonts.bold);
    });
  }
  const signTop = y - 50;
  line(MID, signTop, RIGHT, signTop);
  right(`for ${doc.seller.name}`, RIGHT - 5, signTop - 11, 8, fonts.bold);
  right('Authorised Signatory', RIGHT - 5, y - bottomHeight + 8, 8);
  y -= bottomHeight;

  center('This is a Computer Generated Invoice', LEFT, WIDTH, y - 11, 7);
  if (doc.payment) {
    center(`Received: Rs. ${doc.payment.paid}${doc.payment.writtenOff ? `  |  Settled short: Rs. ${doc.payment.writtenOff}` : ''}  |  Balance due: Rs. ${doc.payment.balance}`, LEFT, WIDTH, y - 22, 7.5, fonts.bold);
  }

  // Page numbers when the goods ran on.
  const pages = pdf.getPages();
  if (pages.length > 1) {
    pages.forEach((each, index) => {
      const label = pdfSafe(`Page ${index + 1} of ${pages.length}`);
      each.drawText(label, { x: RIGHT - fonts.regular.widthOfTextAtSize(label, 7), y: 16, size: 7, font: fonts.regular, color: GREY });
    });
  }

  return pdf.save();
}
