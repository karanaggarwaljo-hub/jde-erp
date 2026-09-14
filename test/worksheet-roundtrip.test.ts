/**
 * The parts worksheet, exported, edited and imported back through the real file parser.
 *
 * The unit tests in detail-import.test.ts hand the planner rows directly. This goes the long way
 * round on purpose — worksheet rows, to CSV, into a File, through parseInventoryFile, into the
 * planner — because the ways this can fail live in the joins: a heading claimed by the wrong
 * field, a part number the spreadsheet reader turns into a date or a number, a byte-order mark
 * swallowing the first column's name.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPartsWorksheet, worksheetToCsv, type WorksheetRow } from '../lib/parts-worksheet';
import { parseInventoryFile } from '../lib/client-import';
import { fieldsToWrite, planDetailUpdates, type DetailMatchProduct } from '../lib/detail-import';

// Four real parts, as they sit in Jai Durga Enterprises' inventory.
const STOCK: DetailMatchProduct[] = [
  { id: 'p-bearing', part_number: 'BIG-P17', oem_number: '', name: 'big pinion beraing 803149/10', brand: '', category: 'bearing', compatibility: '' },
  { id: 'p-grari', part_number: 'PLA-G30', oem_number: '', name: 'plantary grari', brand: '', category: '', compatibility: 'N/m bs4' },
  { id: 'p-pin', part_number: 'P00-12400', oem_number: '', name: 'PIN (12400)', brand: '', category: '', compatibility: '' },
  { id: 'p-oil', part_number: 'MA-M44', oem_number: '', name: 'mak hydraulic oil 26l', brand: 'MAK', category: 'oil', compatibility: '' },
];

async function importEdited(edit: (rows: WorksheetRow[]) => void) {
  const rows = buildPartsWorksheet(STOCK);
  edit(rows);
  const file = new File([worksheetToCsv(rows)], 'parts-worksheet.csv', { type: 'text/csv' });
  const { products } = await parseInventoryFile(file);
  return { parsed: products, plan: planDetailUpdates(products, STOCK) };
}

const rowNamed = (rows: WorksheetRow[], name: string): WorksheetRow => {
  const found = rows.find((row) => row.Name === name);
  assert.ok(found, `worksheet has no row named ${name}`);
  return found;
};

test('the Old label column is read as the current code and never as the part number', async () => {
  const { parsed } = await importEdited(() => {});
  const bearing = parsed.find((row) => row.name === 'big pinion beraing 803149/10');
  assert.ok(bearing);
  assert.equal(bearing.current_code, 'BIG-P17');
  assert.notEqual(bearing.part_number, 'BIG-P17', 'the invented code must not come back as the answer');
});

test('part numbers with slashes and dashes survive the trip through the spreadsheet reader', async () => {
  const { parsed } = await importEdited((rows) => {
    rowNamed(rows, 'plantary grari')['Part No'] = '331/34392';
    rowNamed(rows, 'mak hydraulic oil 26l')['Part No'] = '32/925994';
  });
  assert.equal(parsed.find((row) => row.name === 'plantary grari')?.part_number, '331/34392');
  assert.equal(parsed.find((row) => row.name === 'mak hydraulic oil 26l')?.part_number, '32/925994');
  assert.equal(parsed.find((row) => row.name === 'PIN (12400)')?.part_number, 'P00-12400');
});

test('a corrected name, a real number and compatibility all land from one row', async () => {
  const { plan } = await importEdited((rows) => {
    const row = rowNamed(rows, 'big pinion beraing 803149/10');
    row.Name = 'Big Pinion Bearing';
    row['Part No'] = '803149/10';
    row.Compatibility = 'JCB 3DX';
  });
  const match = plan.find((m) => m.product?.id === 'p-bearing');
  assert.ok(match);
  assert.equal(match.matchedBy, 'current code');
  assert.deepEqual(fieldsToWrite(match, () => true), {
    name: 'Big Pinion Bearing',
    part_number: '803149/10',
    compatibility: 'JCB 3DX',
  });
});

test('compatibility already written is replaced from the worksheet', async () => {
  const { plan } = await importEdited((rows) => {
    rowNamed(rows, 'plantary grari').Compatibility = 'JCB N/M BS4';
  });
  const match = plan.find((m) => m.product?.id === 'p-grari');
  assert.equal(match?.changes.find((c) => c.field === 'compatibility')?.kind, 'replace');
});

test('rows left as exported write only the numbers the worksheet itself suggested', async () => {
  // The worksheet pre-fills Part No with a real number already written inside a part's own name,
  // as a head start. Importing it untouched accepts those suggestions and nothing else.
  const { plan } = await importEdited(() => {});
  for (const match of plan) {
    const patch = fieldsToWrite(match, () => true);
    if (match.product?.id === 'p-bearing') assert.deepEqual(patch, { part_number: '803149/10' });
    else assert.deepEqual(patch, {}, match.name + ' should be untouched');
  }
});

test('a blank cell in the edited worksheet leaves the part as it was', async () => {
  const { plan } = await importEdited((rows) => {
    rowNamed(rows, 'plantary grari').Compatibility = '';
  });
  const match = plan.find((m) => m.product?.id === 'p-grari');
  assert.equal(match?.changes.find((c) => c.field === 'compatibility'), undefined);
});

test('a corrected number that another part already has is held back', async () => {
  const { plan } = await importEdited((rows) => {
    const row = rowNamed(rows, 'plantary grari');
    row.Name = 'Planetary Gear';
    row['Part No'] = 'P00-12400';
  });
  const match = plan.find((m) => m.product?.id === 'p-grari');
  assert.ok(match);
  assert.equal(match.changes.find((c) => c.field === 'part_number')?.kind, 'clash');
  assert.deepEqual(fieldsToWrite(match, () => true), { name: 'Planetary Gear' });
});

test('a part that already had a real number can be renamed from the worksheet', async () => {
  const { plan } = await importEdited((rows) => {
    rowNamed(rows, 'PIN (12400)').Name = 'Pin 12400';
  });
  const match = plan.find((m) => m.product?.id === 'p-pin');
  assert.ok(match);
  assert.deepEqual(fieldsToWrite(match, () => true), { name: 'Pin 12400' });
});
