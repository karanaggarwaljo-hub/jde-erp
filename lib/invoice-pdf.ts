/**
 * Draws a sales invoice as a PDF — small enough to keep one for every invoice for years.
 *
 * Only the PDF format's own built-in fonts are used and nothing is embedded: no font files, no
 * images. That is what keeps a one-page invoice to a few kilobytes. The price is that those fonts
 * cover Western European characters only, so the rupee sign is written "Rs." and any character
 * they cannot draw becomes "?" rather than stopping the invoice from being saved at all.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { InvoiceDocument } from './invoice-document';

const PAGE: [number, number] = [595.28, 841.89]; // A4, in points
const MARGIN = 40;
const RIGHT = PAGE[0] - MARGIN;
const WIDTH = RIGHT - MARGIN;
const FOOTER_SPACE = 36;

const INK = rgb(0.12, 0.12, 0.12);
const MUTED = rgb(0.42, 0.42, 0.42);
const RULE = rgb(0.8, 0.8, 0.8);
const SHADE = rgb(0.95, 0.95, 0.95);

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

/** Breaks text into lines no wider than `width`, splitting a word only when it alone is too long. */
function wrap(value: string, font: PDFFont, size: number, width: number): string[] {
  const words = pdfSafe(value).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  const fits = (candidate: string) => font.widthOfTextAtSize(candidate, size) <= width;
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) { current = candidate; continue; }
    if (current) lines.push(current);
    if (fits(word)) { current = word; continue; }
    let piece = '';
    for (const ch of word) {
      if (fits(piece + ch)) piece += ch;
      else { lines.push(piece); piece = ch; }
    }
    current = piece;
  }
  if (current) lines.push(current);
  return lines;
}

type Column = { key: 'partNumber' | 'description' | 'qty' | 'rate' | 'discount' | 'amount'; label: string; width: number; right?: boolean };

function columnsFor(doc: InvoiceDocument): Column[] {
  const fixed: Column[] = doc.showDiscountColumn
    ? [
        { key: 'partNumber', label: 'Part No.', width: 82 },
        { key: 'qty', label: 'Qty', width: 34, right: true },
        { key: 'rate', label: 'Unit Price', width: 74, right: true },
        { key: 'discount', label: 'Discount', width: 92, right: true },
        { key: 'amount', label: 'Line Total', width: 80, right: true },
      ]
    : [
        { key: 'partNumber', label: 'Part No.', width: 92 },
        { key: 'qty', label: 'Qty', width: 40, right: true },
        { key: 'rate', label: 'Unit Price', width: 86, right: true },
        { key: 'amount', label: 'Line Total', width: 90, right: true },
      ];
  const used = fixed.reduce((sum, column) => sum + column.width, 0);
  const description: Column = { key: 'description', label: 'Description', width: WIDTH - used };
  return [fixed[0], description, ...fixed.slice(1)];
}

export async function renderInvoicePdf(doc: InvoiceDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(`Invoice ${doc.number}`));
  pdf.setAuthor(pdfSafe(doc.companyName));
  pdf.setProducer('JDE ERP');
  pdf.setCreator('JDE ERP');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const draw = (page: PDFPage, value: string, x: number, y: number, size: number, font: PDFFont = regular, color = INK) => {
    page.drawText(pdfSafe(value), { x, y, size, font, color });
  };
  const drawRight = (page: PDFPage, value: string, right: number, y: number, size: number, font: PDFFont = regular, color = INK) => {
    const safe = pdfSafe(value);
    page.drawText(safe, { x: right - font.widthOfTextAtSize(safe, size), y, size, font, color });
  };
  const rule = (page: PDFPage, y: number) => page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 0.6, color: RULE });

  const columns = columnsFor(doc);
  const PAD = 4;

  // ── First page: letterhead, invoice number, bill-to ─────────────────────────────────────────
  let page = pdf.addPage(PAGE);
  let y = PAGE[1] - MARGIN;

  const headingWidth = 170;
  const nameLines = wrap(doc.companyName, bold, 16, WIDTH - headingWidth - 10);
  for (const line of nameLines) { y -= 16; draw(page, line, MARGIN, y, 16, bold); }
  for (const detail of doc.companyLines) {
    for (const line of wrap(detail, regular, 9, WIDTH - headingWidth - 10)) { y -= 12; draw(page, line, MARGIN, y, 9, regular, MUTED); }
  }
  let headY = PAGE[1] - MARGIN - 14;
  drawRight(page, 'TAX INVOICE', RIGHT, headY, 14, bold);
  headY -= 16; drawRight(page, doc.number, RIGHT, headY, 11, bold);
  headY -= 13; drawRight(page, `Date: ${doc.date}`, RIGHT, headY, 9, regular, MUTED);
  headY -= 13; drawRight(page, doc.status, RIGHT, headY, 9, bold, doc.status === 'UNPAID' || doc.status === 'PART PAID' ? rgb(0.7, 0.15, 0.1) : rgb(0.1, 0.45, 0.2));
  y = Math.min(y, headY) - 14;
  rule(page, y);

  y -= 16; draw(page, 'BILL TO', MARGIN, y, 8, bold, MUTED);
  for (const line of wrap(doc.billToName, bold, 11, WIDTH)) { y -= 14; draw(page, line, MARGIN, y, 11, bold); }
  for (const detail of doc.billToLines) {
    for (const line of wrap(detail, regular, 9, WIDTH)) { y -= 12; draw(page, line, MARGIN, y, 9, regular, MUTED); }
  }
  y -= 16;

  // ── Line items ──────────────────────────────────────────────────────────────────────────────
  const tableHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - 16, width: WIDTH, height: 18, color: SHADE });
    let x = MARGIN;
    for (const column of columns) {
      if (column.right) drawRight(page, column.label, x + column.width - PAD, y - 11, 8.5, bold);
      else draw(page, column.label, x + PAD, y - 11, 8.5, bold);
      x += column.width;
    }
    y -= 20;
  };
  const newPage = () => {
    page = pdf.addPage(PAGE);
    y = PAGE[1] - MARGIN;
    y -= 12; draw(page, `${doc.number} (continued)`, MARGIN, y, 9, bold, MUTED);
    y -= 12;
  };

  tableHeader();
  if (doc.emptyNote) {
    y -= 12; draw(page, doc.emptyNote, MARGIN + PAD, y, 9, regular, MUTED);
    y -= 8;
  }
  for (const row of doc.rows) {
    const cells = columns.map((column) => wrap(row[column.key], regular, 9, column.width - PAD * 2));
    const height = Math.max(...cells.map((lines) => lines.length)) * 11 + 7;
    if (y - height < MARGIN + FOOTER_SPACE) { newPage(); tableHeader(); }
    let x = MARGIN;
    columns.forEach((column, index) => {
      cells[index].forEach((line, lineIndex) => {
        const lineY = y - 11 - lineIndex * 11;
        if (column.right) drawRight(page, line, x + column.width - PAD, lineY, 9);
        else draw(page, line, x + PAD, lineY, 9);
      });
      x += column.width;
    });
    y -= height;
    rule(page, y + 2);
  }

  // ── Totals ──────────────────────────────────────────────────────────────────────────────────
  const totalsHeight = doc.totals.length * 15 + 16;
  if (y - totalsHeight < MARGIN + FOOTER_SPACE) newPage();
  y -= 8;
  const labelRight = RIGHT - 110;
  for (const total of doc.totals) {
    y -= 15;
    const font = total.strong ? bold : regular;
    const size = total.strong ? 10.5 : 9.5;
    drawRight(page, total.label, labelRight, y, size, font, total.strong ? INK : MUTED);
    drawRight(page, total.value, RIGHT, y, size, font);
  }

  // ── Footer on every page ────────────────────────────────────────────────────────────────────
  const pages = pdf.getPages();
  pages.forEach((each, index) => {
    draw(each, `${doc.companyName}  |  ${doc.number}  |  Computer-generated invoice`, MARGIN, MARGIN - 14, 7.5, regular, MUTED);
    drawRight(each, `Page ${index + 1} of ${pages.length}`, RIGHT, MARGIN - 14, 7.5, regular, MUTED);
  });

  return pdf.save({ useObjectStreams: true });
}
