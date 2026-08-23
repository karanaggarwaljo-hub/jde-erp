import * as XLSX from 'xlsx';

/** One purchased line, from a spreadsheet or from a scanned invoice.
 *
 *  The identifier fields are optional and often absent — a supplier document may print none of
 *  them. They exist because a description alone is a poor key: the same physical part arrives
 *  named differently from every supplier, while its part/OEM number does not move. */
export type ImportedLine = {
  description: string;
  quantity: number;
  unit_price: number;
  part_number?: string | null;
  oem_number?: string | null;
  brand?: string | null;
  hsn_code?: string | null;
};

const DESCRIPTION_KEYS = ['description', 'item', 'item name', 'part', 'part name', 'product', 'name'];
const QUANTITY_KEYS = ['quantity', 'qty'];
const PRICE_KEYS = ['unit price', 'unit_price', 'price', 'rate', 'cost', 'cost price'];
const LINE_PART_NUMBER_KEYS = ['part number', 'part no', 'part_no', 'partno', 'item code', 'item_code', 'code', 'cat no', 'catalogue no', 'catalog no', 'sku'];
const LINE_OEM_KEYS = ['oem number', 'oem no', 'oem', 'oe number', 'oe no'];
const LINE_BRAND_KEYS = ['brand', 'make', 'manufacturer'];
const LINE_HSN_KEYS = ['hsn code', 'hsn', 'hsn/sac', 'hsn sac', 'hsn no'];

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9\s%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// These single words are common enough inside unrelated compound headers ("ordering cost",
// "unite price" as a typo of "unit price") that fuzzy-matching them causes more false positives
// than correct matches — only match them when a header is exactly this word, and let content-based
// guessing (guessNumericRoles) handle the ambiguous cases instead.
const AMBIGUOUS_SINGLE_WORDS = new Set(['cost', 'price', 'rate', 'value', 'amount', 'total']);

function findKey(row: Record<string, unknown>, candidates: readonly string[]): string | undefined {
  const keys = Object.keys(row);
  const normalizedCandidates = candidates.map(normalizeHeader);
  const exact = keys.find((key) => normalizedCandidates.includes(normalizeHeader(key)));
  if (exact) return exact;
  const fuzzyCandidates = normalizedCandidates.filter((c) => !AMBIGUOUS_SINGLE_WORDS.has(c));
  return keys.find((key) => {
    const normalizedKey = normalizeHeader(key);
    if (!normalizedKey) return false;
    // Only match when the header contains the full candidate phrase (e.g. "Cost Price (Rs.)" contains
    // "cost price"). Matching the reverse direction too would let short headers like "Qty" falsely
    // match unrelated multi-word candidates that happen to contain "qty", e.g. "min qty" for min_stock.
    return fuzzyCandidates.some((candidate) => normalizedKey.includes(candidate));
  });
}

const HEADER_ROW_SIGNAL_WORDS = [
  'name', 'item', 'part', 'description', 'code', 'category', 'type', 'price', 'rate', 'cost',
  'qty', 'quantity', 'stock', 'unit', 'brand', 'supplier', 'oem', 'location', 'amount', 'value', 'no',
];

/**
 * Real-world spreadsheets often have a title row ("Inventory Statement") or blank rows above the
 * actual column headers. Blindly treating row 1 as the header row (the XLSX default) then makes
 * every real header — "Name", "Qty available", etc. — look like ordinary data, so nothing matches.
 * Scan the first few rows and pick whichever one reads the most like a header row.
 */
function detectHeaderRowIndex(rawRows: unknown[][]): number {
  let bestIndex = 0;
  let bestScore = -1;
  const scanLimit = Math.min(rawRows.length, 10);
  for (let i = 0; i < scanLimit; i++) {
    const row = rawRows[i] ?? [];
    const nonEmptyCells = row.map((c) => String(c ?? '').trim()).filter((c) => c !== '');
    if (nonEmptyCells.length < 2) continue;
    const matchingCells = nonEmptyCells.filter((cell) => {
      const normalized = normalizeHeader(cell);
      return HEADER_ROW_SIGNAL_WORDS.some((word) => normalized === word || normalized.includes(word));
    });
    const score = matchingCells.length * 100 + nonEmptyCells.length;
    if (matchingCells.length > 0 && score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/** Re-parses a sheet using whichever row looks like the true header row, instead of always row 1. */
function sheetToRowsWithDetectedHeader(sheet: XLSX.WorkSheet): Array<Record<string, unknown>> {
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  if (rawRows.length === 0) return [];
  const headerRowIndex = detectHeaderRowIndex(rawRows);
  const headers = (rawRows[headerRowIndex] ?? []).map((h, i) => {
    const text = String(h ?? '').trim();
    return text || `__EMPTY_${i}`;
  });
  return rawRows.slice(headerRowIndex + 1).map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((header, i) => {
      obj[header] = row[i] ?? '';
    });
    return obj;
  });
}

/** A "S.No" / "Sr No" / index column counts up by 1 each row — never a real quantity or price. */
function looksLikeRowIndex(rows: Array<Record<string, unknown>>, key: string): boolean {
  let expected: number | null = null;
  let matches = 0;
  let total = 0;
  for (const row of rows) {
    const raw = row[key];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    const n = Number(raw);
    if (Number.isNaN(n)) continue;
    total++;
    if (expected !== null && n === expected) matches++;
    expected = n + 1;
  }
  return total > 3 && matches / total > 0.95;
}

const DERIVED_COLUMN_WORDS = ['value', 'total', 'amount', 'worth'];

/** "Inventory Value" / "Total Amount" columns are usually qty × price, not a raw fact to store. */
function looksLikeDerivedColumn(header: string): boolean {
  const normalized = normalizeHeader(header);
  return DERIVED_COLUMN_WORDS.some((word) => normalized.includes(word));
}

function guessTextColumn(rows: Array<Record<string, unknown>>): string | undefined {
  if (rows.length === 0) return undefined;
  let bestKey: string | undefined;
  let bestScore = 0;
  for (const key of Object.keys(rows[0])) {
    let textCount = 0;
    for (const row of rows) {
      const value = String(row[key] ?? '').trim();
      if (value.length > 1 && Number.isNaN(Number(value))) textCount++;
    }
    if (textCount > bestScore) {
      bestScore = textCount;
      bestKey = key;
    }
  }
  return bestScore > 0 ? bestKey : undefined;
}

type NumericColumnStats = { key: string; avg: number; integerFraction: number; nonEmptyCount: number };

function numericColumnStats(rows: Array<Record<string, unknown>>, key: string): NumericColumnStats | null {
  let sum = 0;
  let integerCount = 0;
  let nonEmptyCount = 0;
  let numericCount = 0;
  for (const row of rows) {
    const raw = row[key];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    nonEmptyCount++;
    const n = Number(raw);
    if (Number.isNaN(n)) continue;
    numericCount++;
    sum += n;
    if (Number.isInteger(n)) integerCount++;
  }
  // Require the column to actually be populated across most rows, not just "numeric where present" —
  // otherwise a column that's empty except for one stray value (e.g. a note in an "ordering cost"
  // column meant for a different workflow) looks 100% numeric and gets mistaken for a real field.
  if (rows.length === 0 || nonEmptyCount / rows.length < 0.5 || numericCount / nonEmptyCount < 0.6) return null;
  return { key, avg: sum / numericCount, integerFraction: integerCount / numericCount, nonEmptyCount };
}

/**
 * When the file's own headers don't tell us which column is quantity vs. cost vs. selling
 * price, infer it from the numbers themselves: quantity columns are almost always whole
 * numbers, and of the two price-like columns left, the seller normally charges more than
 * they paid, so the higher-average column is the selling price.
 */
function guessNumericRoles(
  rows: Array<Record<string, unknown>>,
  claimedKeys: Set<string>
): { stock?: string; cost?: string; sale?: string } {
  const allKeys = rows.length > 0 ? Object.keys(rows[0]) : [];
  const candidates = allKeys
    .filter((k) => !claimedKeys.has(k) && !looksLikeDerivedColumn(k) && !looksLikeRowIndex(rows, k))
    .map((k) => numericColumnStats(rows, k))
    .filter((s): s is NumericColumnStats => s !== null);

  if (candidates.length === 0) return {};

  const byIntegerness = [...candidates].sort((a, b) => b.integerFraction - a.integerFraction || a.avg - b.avg);
  const stock = byIntegerness[0];
  const priceCandidates = candidates.filter((c) => c.key !== stock?.key).sort((a, b) => a.avg - b.avg);

  if (priceCandidates.length >= 2) {
    return { stock: stock?.key, cost: priceCandidates[0].key, sale: priceCandidates[priceCandidates.length - 1].key };
  }
  if (priceCandidates.length === 1) {
    return { stock: stock?.key, sale: priceCandidates[0].key };
  }
  return { stock: stock?.key };
}

export async function parseSpreadsheetFile(file: File): Promise<ImportedLine[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
  if (!sheet) {
    throw new Error('This file has no readable sheet — it may be empty, corrupted, or not a valid CSV/Excel file.');
  }
  const rows = sheetToRowsWithDetectedHeader(sheet);

  const lines: ImportedLine[] = [];
  for (const row of rows) {
    const descKey = findKey(row, DESCRIPTION_KEYS);
    const qtyKey = findKey(row, QUANTITY_KEYS);
    const priceKey = findKey(row, PRICE_KEYS);
    const description = descKey ? String(row[descKey]).trim() : '';
    if (!description) continue;
    const quantity = qtyKey ? Number(row[qtyKey]) || 0 : 0;
    const unitPrice = priceKey ? Number(row[priceKey]) || 0 : 0;
    const cell = (keys: string[]): string | null => {
      const key = findKey(row, keys);
      const value = key ? String(row[key]).trim() : '';
      return value || null;
    };
    lines.push({
      description,
      quantity: quantity || 1,
      unit_price: unitPrice,
      part_number: cell(LINE_PART_NUMBER_KEYS),
      oem_number: cell(LINE_OEM_KEYS),
      brand: cell(LINE_BRAND_KEYS),
      hsn_code: cell(LINE_HSN_KEYS),
    });
  }
  return lines;
}

export type ImportedProduct = {
  part_number: string;
  oem_number: string;
  hsn_code: string;
  name: string;
  brand: string;
  category: string;
  compatibility: string;
  cost_price: number;
  mrp: number;
  sale_price: number;
  current_stock: number;
  min_stock: number;
  location: string;
};

const PRODUCT_KEYS = {
  part_number: ['part number', 'part no', 'partno', 'p no', 'sku', 'code', 'item code', 'material code', 'material no', 'product code'],
  oem_number: ['oem number', 'oem', 'oem no', 'oem code'],
  hsn_code: ['hsn code', 'hsn', 'hsn/sac', 'hsn sac', 'hsn no'],
  name: ['name', 'item name', 'part name', 'description', 'desc', 'item description', 'part description', 'product name', 'product', 'item', 'spare part', 'particulars'],
  brand: ['brand', 'manufacturer', 'make', 'company'],
  category: ['category', 'type', 'group', 'segment'],
  compatibility: ['compatibility', 'vehicle', 'model', 'compatible models', 'application', 'suitable for'],
  cost_price: ['cost price', 'cost', 'purchase price', 'purchase rate', 'net rate', 'net price', 'buying price', 'dealer price', 'landing cost'],
  mrp: ['mrp', 'list price', 'maximum retail price'],
  sale_price: ['sale price', 'selling price', 'sales rate', 'retail price', 'price', 'rate', 'unit price'],
  discount: ['discount', 'discount percent', 'disc', 'trade discount'],
  current_stock: ['current stock', 'stock', 'quantity', 'qty', 'initial stock', 'units', 'no of units', 'nos', 'available stock', 'in stock', 'stock qty'],
  min_stock: ['min stock', 'minimum stock', 'reorder level', 'reorder point', 'min qty'],
  location: ['location', 'loc', 'rack', 'bin', 'shelf', 'warehouse'],
} as const;

export type InventoryImportResult = { products: ImportedProduct[]; guessedFields: string[] };

export async function parseInventoryFile(file: File): Promise<InventoryImportResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
  if (!sheet) {
    throw new Error('This file has no readable sheet — it may be empty, corrupted, or not a valid CSV/Excel file.');
  }
  const rows = sheetToRowsWithDetectedHeader(sheet);

  const get = (row: Record<string, unknown>, keys: readonly string[]) => {
    const key = findKey(row, keys);
    return key ? String(row[key]).trim() : '';
  };

  const sampleRow = rows[0] ?? {};
  const hasStructuredName = Boolean(findKey(sampleRow, PRODUCT_KEYS.name) || findKey(sampleRow, PRODUCT_KEYS.part_number));
  const fallbackNameKey = hasStructuredName ? undefined : guessTextColumn(rows);

  // Resolve every header-matchable column once up front, then use whatever numeric columns
  // are left over to guess quantity/cost/sale price when the headers themselves don't say.
  const headerKeys = {
    part_number: findKey(sampleRow, PRODUCT_KEYS.part_number),
    oem_number: findKey(sampleRow, PRODUCT_KEYS.oem_number),
    hsn_code: findKey(sampleRow, PRODUCT_KEYS.hsn_code),
    name: findKey(sampleRow, PRODUCT_KEYS.name) ?? fallbackNameKey,
    brand: findKey(sampleRow, PRODUCT_KEYS.brand),
    category: findKey(sampleRow, PRODUCT_KEYS.category),
    compatibility: findKey(sampleRow, PRODUCT_KEYS.compatibility),
    cost_price: findKey(sampleRow, PRODUCT_KEYS.cost_price),
    mrp: findKey(sampleRow, PRODUCT_KEYS.mrp),
    sale_price: findKey(sampleRow, PRODUCT_KEYS.sale_price),
    discount: findKey(sampleRow, PRODUCT_KEYS.discount),
    current_stock: findKey(sampleRow, PRODUCT_KEYS.current_stock),
    min_stock: findKey(sampleRow, PRODUCT_KEYS.min_stock),
    location: findKey(sampleRow, PRODUCT_KEYS.location),
  };

  const claimedKeys = new Set(Object.values(headerKeys).filter((k): k is string => Boolean(k)));
  const needsGuessing = !headerKeys.current_stock || !headerKeys.cost_price || !headerKeys.sale_price;
  const guessed = needsGuessing ? guessNumericRoles(rows, claimedKeys) : {};

  const guessedFields: string[] = [];
  if (!headerKeys.current_stock && guessed.stock) guessedFields.push('stock quantity');
  if (!headerKeys.cost_price && guessed.cost) guessedFields.push('cost price');
  if (!headerKeys.sale_price && guessed.sale) guessedFields.push('selling price');

  const numberAt = (row: Record<string, unknown>, key: string | undefined) => {
    if (!key) return 0;
    return Number(row[key]) || 0;
  };

  const products: ImportedProduct[] = [];
  for (const row of rows) {
    let name = get(row, PRODUCT_KEYS.name);
    const partNumber = get(row, PRODUCT_KEYS.part_number);
    if (!name && !partNumber && fallbackNameKey) {
      name = String(row[fallbackNameKey] ?? '').trim();
    }
    if (!name && !partNumber) continue;

    const mrpValue = numberAt(row, headerKeys.mrp);
    const discountPercent = numberAt(row, headerKeys.discount);
    let costPrice = headerKeys.cost_price ? numberAt(row, headerKeys.cost_price) : numberAt(row, guessed.cost);
    if (!costPrice && discountPercent && mrpValue) {
      costPrice = Math.round(mrpValue * (1 - discountPercent / 100) * 100) / 100;
    }
    const salePrice = headerKeys.sale_price ? numberAt(row, headerKeys.sale_price) : numberAt(row, guessed.sale);
    const currentStock = headerKeys.current_stock ? numberAt(row, headerKeys.current_stock) : numberAt(row, guessed.stock);

    products.push({
      part_number: partNumber,
      oem_number: get(row, PRODUCT_KEYS.oem_number),
      hsn_code: get(row, PRODUCT_KEYS.hsn_code),
      name: name || partNumber,
      brand: get(row, PRODUCT_KEYS.brand),
      category: get(row, PRODUCT_KEYS.category),
      compatibility: get(row, PRODUCT_KEYS.compatibility),
      cost_price: costPrice,
      mrp: mrpValue,
      sale_price: salePrice,
      current_stock: currentStock,
      min_stock: Number(get(row, PRODUCT_KEYS.min_stock)) || 0,
      location: get(row, PRODUCT_KEYS.location),
    });
  }
  return { products, guessedFields };
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** SHA-256 of the file's raw bytes, as a hex string — identifies this exact file (not its
 *  filename) so the same invoice photo/PDF can't be scanned or recorded as a purchase twice,
 *  even under a renamed copy. Content-based, not filename-based, so a re-saved or re-shared copy
 *  of the same file is still recognized. */
export async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const SPREADSHEET_EXTENSIONS = ['.csv', '.xls', '.xlsx'];
export const SCANNABLE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
