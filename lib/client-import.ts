import * as XLSX from 'xlsx';

export type ImportedLine = { description: string; quantity: number; unit_price: number };

const DESCRIPTION_KEYS = ['description', 'item', 'item name', 'part', 'part name', 'product', 'name'];
const QUANTITY_KEYS = ['quantity', 'qty'];
const PRICE_KEYS = ['unit price', 'unit_price', 'price', 'rate', 'cost', 'cost price'];

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9\s%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findKey(row: Record<string, unknown>, candidates: readonly string[]): string | undefined {
  const keys = Object.keys(row);
  const normalizedCandidates = candidates.map(normalizeHeader);
  const exact = keys.find((key) => normalizedCandidates.includes(normalizeHeader(key)));
  if (exact) return exact;
  return keys.find((key) => {
    const normalizedKey = normalizeHeader(key);
    if (!normalizedKey) return false;
    // Only match when the header contains the full candidate phrase (e.g. "Cost Price (Rs.)" contains
    // "cost price"). Matching the reverse direction too would let short headers like "Qty" falsely
    // match unrelated multi-word candidates that happen to contain "qty", e.g. "min qty" for min_stock.
    return normalizedCandidates.some((candidate) => normalizedKey.includes(candidate));
  });
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

export async function parseSpreadsheetFile(file: File): Promise<ImportedLine[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
  if (!sheet) {
    throw new Error('This file has no readable sheet — it may be empty, corrupted, or not a valid CSV/Excel file.');
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  const lines: ImportedLine[] = [];
  for (const row of rows) {
    const descKey = findKey(row, DESCRIPTION_KEYS);
    const qtyKey = findKey(row, QUANTITY_KEYS);
    const priceKey = findKey(row, PRICE_KEYS);
    const description = descKey ? String(row[descKey]).trim() : '';
    if (!description) continue;
    const quantity = qtyKey ? Number(row[qtyKey]) || 0 : 0;
    const unitPrice = priceKey ? Number(row[priceKey]) || 0 : 0;
    lines.push({ description, quantity: quantity || 1, unit_price: unitPrice });
  }
  return lines;
}

export type ImportedProduct = {
  part_number: string;
  oem_number: string;
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

export async function parseInventoryFile(file: File): Promise<ImportedProduct[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
  if (!sheet) {
    throw new Error('This file has no readable sheet — it may be empty, corrupted, or not a valid CSV/Excel file.');
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  const get = (row: Record<string, unknown>, keys: readonly string[]) => {
    const key = findKey(row, keys);
    return key ? String(row[key]).trim() : '';
  };

  const sampleRow = rows[0] ?? {};
  const hasStructuredName = Boolean(findKey(sampleRow, PRODUCT_KEYS.name) || findKey(sampleRow, PRODUCT_KEYS.part_number));
  const fallbackNameKey = hasStructuredName ? undefined : guessTextColumn(rows);

  const products: ImportedProduct[] = [];
  for (const row of rows) {
    let name = get(row, PRODUCT_KEYS.name);
    const partNumber = get(row, PRODUCT_KEYS.part_number);
    if (!name && !partNumber && fallbackNameKey) {
      name = String(row[fallbackNameKey] ?? '').trim();
    }
    if (!name && !partNumber) continue;

    const mrpValue = Number(get(row, PRODUCT_KEYS.mrp)) || 0;
    const discountPercent = Number(get(row, PRODUCT_KEYS.discount)) || 0;
    let costPrice = Number(get(row, PRODUCT_KEYS.cost_price)) || 0;
    if (!costPrice && discountPercent && mrpValue) {
      costPrice = Math.round(mrpValue * (1 - discountPercent / 100) * 100) / 100;
    }

    products.push({
      part_number: partNumber,
      oem_number: get(row, PRODUCT_KEYS.oem_number),
      name: name || partNumber,
      brand: get(row, PRODUCT_KEYS.brand),
      category: get(row, PRODUCT_KEYS.category),
      compatibility: get(row, PRODUCT_KEYS.compatibility),
      cost_price: costPrice,
      mrp: mrpValue,
      sale_price: Number(get(row, PRODUCT_KEYS.sale_price)) || 0,
      current_stock: Number(get(row, PRODUCT_KEYS.current_stock)) || 0,
      min_stock: Number(get(row, PRODUCT_KEYS.min_stock)) || 0,
      location: get(row, PRODUCT_KEYS.location),
    });
  }
  return products;
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

export const SPREADSHEET_EXTENSIONS = ['.csv', '.xls', '.xlsx'];
export const SCANNABLE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
