/** The parts worksheet: a spreadsheet of everything this company stocks, for correcting part
 *  numbers away from the desk and importing the answers straight back.
 *
 *  Why this exists. Of the 252 parts in Jai Durga Enterprises, 244 carry a code this app invented
 *  from the first letters of the name — `AIR-F90`, `STI-B168`, `SP-053`. Those mean nothing to a
 *  customer or a supplier. The real numbers are stamped on the parts and printed on supplier
 *  paperwork, and no amount of software can derive one from `AIR-F90`; they have to be read off
 *  the shelf. This produces the paper for that walk, already filled in with everything known, and
 *  its columns are named so the answers import back through the "Fill in part numbers & details"
 *  mode that already exists — no second importer.
 *
 *  Column naming is load-bearing, not cosmetic. lib/client-import.ts matches a heading against
 *  PRODUCT_KEYS both exactly and by "does this heading contain the phrase", so a well-meaning
 *  label like "Current internal code" would be picked up as the part number and quietly write the
 *  invented code straight back. Every heading below is checked against those keys.
 */

export type WorksheetProduct = {
  part_number?: string | null;
  oem_number?: string | null;
  name?: string | null;
  brand?: string | null;
  category?: string | null;
  compatibility?: string | null;
  current_stock?: number | string | null;
};

export type WorksheetRow = {
  Name: string;
  'Part No': string;
  'OEM No': string;
  Brand: string;
  Category: string;
  Compatibility: string;
  Stock: string;
  /** Deliberately NOT a name any importer key matches, so the invented code cannot be read back
   *  in and re-saved as the answer. It is here only so a row can be recognised on screen. */
  'Old label': string;
};

export const WORKSHEET_COLUMNS: (keyof WorksheetRow)[] = [
  'Name', 'Part No', 'OEM No', 'Brand', 'Category', 'Compatibility', 'Stock', 'Old label',
];

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value));

/** Codes this app generated itself, which must never be offered back as an answer.
 *  Mirrors looksLikeAnInventedCode in lib/detail-import.ts — kept in step by the test that
 *  feeds both the same real examples. */
function isInvented(code: string): boolean {
  const raw = text(code);
  if (!raw) return false;
  if (/\s/.test(raw)) return true;
  const compact = raw.toUpperCase();
  return /^SP-?\d{1,6}$/.test(compact) || /^[A-Z]{2,4}-[A-Z]?\d{1,4}$/.test(compact);
}

/**
 * A real part number already sitting inside the part's own NAME.
 *
 * Free progress: the owner typed the number into the description and then let the app generate a
 * meaningless code beside it. Eight parts in the live inventory are like this — "rear hub bearing
 * 37425-625", "small pinion beraing 89449/10", "GBP-600, GREASE BUCKET 6KG DURELO".
 *
 * Deliberately conservative. It only accepts shapes a manufacturer actually prints — digits with
 * a separator, or letters-then-digits with a dash — and never returns a bare number, because
 * "6KG", "26l" and "2012" are a weight, a volume and a year, not part numbers.
 */
export function numberHidingInName(name: string): string {
  const raw = text(name);
  if (!raw) return '';

  const patterns = [
    /\b\d{3,6}\s*[\/-]\s*[A-Z]?\d{1,6}\b/i,   // 37425-625, 89449/10, 331/34392
    /\b[A-Z]{2,4}-\d{3,6}\b/i,                // GBP-600
    /\b\d{2,3}\/[A-Z]\d{3,5}\b/i,             // 335/Y7275
  ];
  for (const pattern of patterns) {
    const found = raw.match(pattern);
    if (found) return found[0].replace(/\s+/g, '');
  }
  return '';
}

/** One row per part, with everything already known filled in and the part number left for the
 *  owner — pre-filled only when a real one is already on file or recoverable from the name. */
export function buildPartsWorksheet(products: WorksheetProduct[]): WorksheetRow[] {
  return products
    .map((product) => {
      const existing = text(product.part_number);
      const suggestion = isInvented(existing) || !existing ? numberHidingInName(text(product.name)) : existing;
      return {
        Name: text(product.name),
        'Part No': suggestion,
        'OEM No': text(product.oem_number),
        Brand: text(product.brand),
        Category: text(product.category),
        Compatibility: text(product.compatibility),
        Stock: text(product.current_stock),
        'Old label': isInvented(existing) ? existing : '',
      };
    })
    // Parts still needing an answer come first: that is the work, and a 252-row sheet is easier
    // to walk when the blanks are at the top rather than scattered through it.
    .sort((a, b) => {
      const aNeeds = a['Part No'] ? 1 : 0;
      const bNeeds = b['Part No'] ? 1 : 0;
      return aNeeds - bNeeds || a.Name.localeCompare(b.Name);
    });
}

/** How many rows still have no part number — the honest size of the job, for the button to say. */
export function countUnanswered(rows: WorksheetRow[]): number {
  return rows.filter((row) => !row['Part No']).length;
}

const escapeCell = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** CSV rather than .xlsx: Excel, Google Sheets and every phone spreadsheet app open it, and the
 *  file can be read back by the importer unchanged.
 *
 *  The BOM is not decoration — without it Excel on Windows reads UTF-8 as the local codepage and
 *  turns ₹ and any Hindi text into mojibake, which the owner would then "correct" by hand. */
export function worksheetToCsv(rows: WorksheetRow[]): string {
  const header = WORKSHEET_COLUMNS.join(',');
  const body = rows.map((row) => WORKSHEET_COLUMNS.map((column) => escapeCell(row[column])).join(','));
  return '﻿' + [header, ...body].join('\r\n') + '\r\n';
}

/** A filename that sorts by date and says which company it came from, since this ERP holds
 *  several and two worksheets in a downloads folder must be tellable apart. */
export function worksheetFileName(companyName: string, today: string): string {
  const safe = (companyName || 'company').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return `parts-worksheet-${safe || 'company'}-${today}.csv`;
}
