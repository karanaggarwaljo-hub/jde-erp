import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { parseCostUpdateFile } from '../lib/client-import';

/** Builds a real .xlsx in memory and hands it over as a File, exactly as the browser would. */
function sheetAsFile(rows: unknown[][], name = 'costs.xlsx'): File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([buffer], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

test('reads a plain cost sheet and reports which column it used', async () => {
  const parsed = await parseCostUpdateFile(
    sheetAsFile([
      ['Part No', 'Description', 'Cost Price'],
      ['JCB-H49', 'JCB Hydraulic Oil 20L', 6250],
      ['SER-E37', 'Servo Engine Oil 5L', 1310],
    ])
  );
  assert.equal(parsed.costColumn, 'Cost Price');
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(
    parsed.rows.map((r) => [r.partNumber, r.cost]),
    [['JCB-H49', 6250], ['SER-E37', 1310]]
  );
});

test('accepts costs written with rupee signs, commas and stray spaces', async () => {
  const parsed = await parseCostUpdateFile(
    sheetAsFile([
      ['Part No', 'Cost'],
      ['A-1', '₹1,250.50'],
      ['A-2', ' 6,250 '],
      ['A-3', '430'],
    ])
  );
  assert.deepEqual(parsed.rows.map((r) => r.cost), [1250.5, 6250, 430]);
});

test('skips unreadable and non-positive costs instead of writing a zero over a real price', async () => {
  const parsed = await parseCostUpdateFile(
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
  assert.deepEqual(parsed.rows.map((r) => [r.partNumber, r.cost]), [['A-6', 999]]);
  assert.equal(parsed.skippedNoCost, 5);
});

test('finds the header row even when the sheet starts with title junk', async () => {
  const parsed = await parseCostUpdateFile(
    sheetAsFile([
      ['SHREE BALAJI AUTO SPARES', '', ''],
      ['Price list valid August 2026', '', ''],
      ['', '', ''],
      ['Part No', 'Description', 'Purchase Rate'],
      ['BOS-F12', 'Bosch Fuel Filter', 430],
    ])
  );
  assert.equal(parsed.costColumn, 'Purchase Rate');
  assert.deepEqual(parsed.rows.map((r) => r.partNumber), ['BOS-F12']);
});

test('refuses a file with no recognisable cost column rather than guessing one', async () => {
  await assert.rejects(
    () => parseCostUpdateFile(sheetAsFile([['Part No', 'Qty', 'Colour'], ['A-1', 5, 'red']])),
    /Couldn't find a cost column/
  );
});

test('refuses a file with costs but nothing identifying the part', async () => {
  await assert.rejects(
    () => parseCostUpdateFile(sheetAsFile([['Cost Price', 'Qty'], [500, 5]])),
    /identifying which part/
  );
});

test('a sheet identified only by name still parses', async () => {
  const parsed = await parseCostUpdateFile(
    sheetAsFile([
      ['Item Name', 'Cost Price'],
      ['Bosch Fuel Filter', 445],
    ])
  );
  assert.deepEqual(parsed.rows.map((r) => [r.name, r.cost]), [['Bosch Fuel Filter', 445]]);
});

test('row numbers point at the data row, so a problem row can be found in the file', async () => {
  const parsed = await parseCostUpdateFile(
    sheetAsFile([
      ['Part No', 'Cost Price'],
      ['A-1', 100],
      ['A-2', 'junk'],
      ['A-3', 300],
    ])
  );
  assert.deepEqual(parsed.rows.map((r) => [r.rowNumber, r.partNumber]), [[1, 'A-1'], [3, 'A-3']]);
});
