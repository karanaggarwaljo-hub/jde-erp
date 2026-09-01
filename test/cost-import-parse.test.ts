import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { readSheetForCostUpdate, extractCostRows, sampleColumnValues } from '../lib/client-import';

/** Builds a real .xlsx in memory and hands it over as a File, exactly as the browser would. */
function sheetAsFile(rows: unknown[][], name = 'costs.xlsx'): File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([buffer], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** The real inventory statement this was built against: a title row above the headings, a typo'd
 *  cost column, two stock-control "cost" columns that are not purchase costs, a derived value
 *  column, and a tail of blank columns. */
const REAL_SHEET: unknown[][] = [
  ['', 'Inventory statement', '', '', '', '', '', '', '', '', '', '', ''],
  ['S.No', 'Item code', 'Name', 'category', 'unite price', 'Qty available', 'inventory value', 'supplier name ', 'ordering cost', 'holding cost', 'annual demand', '', ''],
  [1, 'HYD-P01', 'Hydraulic Pump', 'Hydraulics', 19200, 4, 76800, '', '', '', '', '', ''],
  [2, 'GRE-G02', 'Greas gun 1kg', 'Lubricants & Fluids', 650, 16, 10400, '', '', '', '', '', ''],
  [3, 'FIL-K03', 'Filter kit 1000 hr service kit (BS3)', 'Filters', 8277, 4, 33108, '', '', '', '', '', ''],
];

test('suggests the typo’d "unite price" as the cost column on the real sheet', async () => {
  const sheet = await readSheetForCostUpdate(sheetAsFile(REAL_SHEET));
  assert.equal(sheet.suggestedCostColumn, 'unite price');
});

test('never suggests ordering cost, holding cost or the derived inventory value', async () => {
  const sheet = await readSheetForCostUpdate(sheetAsFile(REAL_SHEET));
  assert.notEqual(sheet.suggestedCostColumn, 'ordering cost');
  assert.notEqual(sheet.suggestedCostColumn, 'holding cost');
  assert.notEqual(sheet.suggestedCostColumn, 'inventory value');
});

test('an ordering-cost column with real numbers in it is still never the suggestion', async () => {
  const withValues = REAL_SHEET.map((row, i) => (i >= 2 ? [...row.slice(0, 8), 500, 20, '', '', ''] : row));
  const sheet = await readSheetForCostUpdate(sheetAsFile(withValues));
  assert.equal(sheet.suggestedCostColumn, 'unite price');
});

test('suggests the item-code column for matching parts', async () => {
  const sheet = await readSheetForCostUpdate(sheetAsFile(REAL_SHEET));
  assert.equal(sheet.suggestedIdColumn, 'Item code');
});

test('drops the blank trailing columns a real export leaves behind', async () => {
  const sheet = await readSheetForCostUpdate(sheetAsFile(REAL_SHEET));
  assert.ok(!sheet.columns.some((c) => c.startsWith('__EMPTY')), sheet.columns.join(', '));
  assert.ok(sheet.columns.includes('unite price'));
  assert.ok(sheet.columns.includes('Item code'));
});

test('extracts rows using whichever columns were chosen', async () => {
  const sheet = await readSheetForCostUpdate(sheetAsFile(REAL_SHEET));
  const parsed = extractCostRows(sheet, 'unite price', 'Item code');
  assert.deepEqual(
    parsed.rows.map((r) => [r.partNumber, r.cost]),
    [['HYD-P01', 19200], ['GRE-G02', 650], ['FIL-K03', 8277]]
  );
});

test('choosing a different column really changes what is read', async () => {
  const sheet = await readSheetForCostUpdate(sheetAsFile(REAL_SHEET));
  const asQty = extractCostRows(sheet, 'Qty available', 'Item code');
  assert.deepEqual(asQty.rows.map((r) => r.cost), [4, 16, 4]);
});

test('shows sample values so a column choice can be eyeballed before applying', async () => {
  const sheet = await readSheetForCostUpdate(sheetAsFile(REAL_SHEET));
  assert.deepEqual(sampleColumnValues(sheet, 'unite price'), ['19200', '650', '8277']);
});

test('accepts costs written with rupee signs, commas and stray spaces', async () => {
  const sheet = await readSheetForCostUpdate(
    sheetAsFile([
      ['Part No', 'Cost'],
      ['A-1', '₹1,250.50'],
      ['A-2', ' 6,250 '],
      ['A-3', '430'],
    ])
  );
  const parsed = extractCostRows(sheet, 'Cost', 'Part No');
  assert.deepEqual(parsed.rows.map((r) => r.cost), [1250.5, 6250, 430]);
});

test('skips unreadable and non-positive costs instead of writing a zero over a real price', async () => {
  const sheet = await readSheetForCostUpdate(
    sheetAsFile([
      ['Part No', 'Cost Price'],
      ['A-1', 'call for price'],
      ['A-2', ''],
      ['A-3', 0],
      ['A-4', -50],
      ['A-5', 'N/A'],
      ['A-6', 999],
    ])
  );
  const parsed = extractCostRows(sheet, 'Cost Price', 'Part No');
  assert.deepEqual(parsed.rows.map((r) => [r.partNumber, r.cost]), [['A-6', 999]]);
  assert.equal(parsed.skippedNoCost, 5);
});

test('row numbers point at the data row, so a problem row can be found in the file', async () => {
  const sheet = await readSheetForCostUpdate(
    sheetAsFile([
      ['Part No', 'Cost Price'],
      ['A-1', 100],
      ['A-2', 'junk'],
      ['A-3', 300],
    ])
  );
  const parsed = extractCostRows(sheet, 'Cost Price', 'Part No');
  assert.deepEqual(parsed.rows.map((r) => [r.rowNumber, r.partNumber]), [[1, 'A-1'], [3, 'A-3']]);
});

test('a sheet with no recognisable cost column still opens, with nothing pre-selected', async () => {
  const sheet = await readSheetForCostUpdate(sheetAsFile([['Part No', 'Colour'], ['A-1', 'red']]));
  assert.equal(sheet.suggestedCostColumn, undefined);
  assert.deepEqual(sheet.columns, ['Part No', 'Colour']);
});

test('an empty sheet is refused rather than opening a picker over nothing', async () => {
  await assert.rejects(() => readSheetForCostUpdate(sheetAsFile([['Part No', 'Cost Price']])), /no data rows/);
});
