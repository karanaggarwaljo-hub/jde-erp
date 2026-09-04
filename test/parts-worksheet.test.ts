import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WORKSHEET_COLUMNS,
  buildPartsWorksheet,
  countUnanswered,
  numberHidingInName,
  worksheetFileName,
  worksheetToCsv,
} from '../lib/parts-worksheet';
import { looksLikeAnInventedCode } from '../lib/detail-import';

// ── Numbers already hiding in the part name ─────────────────────────────────────────────────

/** All eight of these are real rows from the live inventory. */
test('a real number typed into the name is recovered', () => {
  const cases: [string, string][] = [
    ['rear hub bearing 37425-625', '37425-625'],
    ['small front hub bearing 501349/10', '501349/10'],
    ['big pinion beraing 803149/10', '803149/10'],
    ['small pinion beraing 89449/10', '89449/10'],
    ['bigfront hub bearing 3780/20', '3780/20'],
    ['transmissin bearing 25877/20', '25877/20'],
    ['handi bearing 387-382', '387-382'],
    ['GBP-600, GREASE BUCKET 6KG DURELO', 'GBP-600'],
  ];
  for (const [name, expected] of cases) {
    assert.equal(numberHidingInName(name), expected, name);
  }
});

/** The costly failure would be offering a weight or a year as a part number. */
test('measurements, volumes and years are never mistaken for a part number', () => {
  for (const name of [
    'mak hydraulic oil 26l',
    'jcb engine oil 15l',
    'air filter jcb 2012',
    'GREASE BUCKET 6KG',
    'coach ceiling fan 9',
    'brake plate terex (set of 10)',
    'servo engine oil 5l',
    'boom bush 131',
  ]) {
    assert.equal(numberHidingInName(name), '', name);
  }
});

test('a name with nothing in it yields nothing', () => {
  assert.equal(numberHidingInName(''), '');
  assert.equal(numberHidingInName('   '), '');
  assert.equal(numberHidingInName('filter kit'), '');
});

test('spacing around the separator is tidied away', () => {
  assert.equal(numberHidingInName('rear hub bearing 37425 - 625'), '37425-625');
});

// ── Building the sheet ──────────────────────────────────────────────────────────────────────

test('an invented code is never offered back as the answer', () => {
  const [row] = buildPartsWorksheet([{ name: 'air filter jcb 2012', part_number: 'AIR-F90' }]);
  assert.equal(row['Part No'], '', 'the blank is the work to be done');
  assert.equal(row['Old label'], 'AIR-F90', 'but the row is still recognisable');
});

test('a real number already on file is kept, not blanked', () => {
  const [row] = buildPartsWorksheet([{ name: 'cab mounting', part_number: '331/34392' }]);
  assert.equal(row['Part No'], '331/34392');
  assert.equal(row['Old label'], '', 'nothing invented to show');
});

test('a number recovered from the name is pre-filled', () => {
  const [row] = buildPartsWorksheet([{ name: 'rear hub bearing 37425-625', part_number: 'REA-H16' }]);
  assert.equal(row['Part No'], '37425-625');
  assert.equal(row['Old label'], 'REA-H16');
});

test('everything already known is carried across so it need not be retyped', () => {
  const [row] = buildPartsWorksheet([{
    name: 'oil filter', part_number: 'SP-053', oem_number: 'RE504836', brand: 'JCB',
    category: 'Filters', compatibility: 'JCB N/M (bs4)', current_stock: 12,
  }]);
  assert.equal(row['OEM No'], 'RE504836');
  assert.equal(row.Brand, 'JCB');
  assert.equal(row.Category, 'Filters');
  assert.equal(row.Compatibility, 'JCB N/M (bs4)');
  assert.equal(row.Stock, '12');
});

test('the parts still needing an answer come first', () => {
  const rows = buildPartsWorksheet([
    { name: 'zzz known', part_number: '331/34392' },
    { name: 'aaa unknown', part_number: 'AIR-F90' },
    { name: 'bbb unknown', part_number: 'SP-001' },
  ]);
  assert.deepEqual(rows.map((r) => r.Name), ['aaa unknown', 'bbb unknown', 'zzz known']);
  assert.equal(countUnanswered(rows), 2);
});

// ── The headings the importer will read ─────────────────────────────────────────────────────

/** lib/client-import.ts matches a heading against PRODUCT_KEYS both exactly AND by "does the
 *  heading contain the phrase". A label like "Current internal code" would therefore be read as
 *  the part number and write the invented code straight back in. */
test('no read-only heading can be mistaken for a field the importer writes', () => {
  const importerPhrases = [
    'part number', 'part no', 'partno', 'p no', 'sku', 'code', 'item code', 'material code',
    'material no', 'product code', 'oem number', 'oem', 'oem no', 'oem code', 'hsn', 'name',
    'description', 'brand', 'manufacturer', 'make', 'company', 'category', 'compatibility',
    'model', 'application', 'suitable for',
  ];
  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s%]/g, ' ').replace(/\s+/g, ' ').trim();
  const readOnly = normalise('Old label');
  for (const phrase of importerPhrases) {
    assert.equal(readOnly.includes(normalise(phrase)), false, `"Old label" must not read as "${phrase}"`);
  }
});

test('the headings the owner fills in DO match what the importer expects', () => {
  assert.ok(WORKSHEET_COLUMNS.includes('Part No'));
  assert.ok(WORKSHEET_COLUMNS.includes('Name'));
  assert.equal(WORKSHEET_COLUMNS[0], 'Name', 'the part is identified first, then answered');
});

/** Two modules decide what an invented code looks like; they must not drift apart. */
test('the sheet and the importer agree on what counts as an invented code', () => {
  for (const code of ['SP-053', 'AIR-F90', 'STI-B168', 'HP -G39', 'MA-M44']) {
    assert.equal(looksLikeAnInventedCode(code), true, code);
    assert.equal(buildPartsWorksheet([{ name: 'x', part_number: code }])[0]['Old label'], code, code);
  }
  for (const code of ['331/34392', '32/925994', 'P00-12400', 'RE504836']) {
    assert.equal(looksLikeAnInventedCode(code), false, code);
    assert.equal(buildPartsWorksheet([{ name: 'x', part_number: code }])[0]['Part No'], code, code);
  }
});

// ── The file itself ─────────────────────────────────────────────────────────────────────────

test('a comma or a quote in a name cannot break the file apart', () => {
  const csv = worksheetToCsv(buildPartsWorksheet([
    { name: 'GBP-600, GREASE BUCKET 6KG DURELO', part_number: 'SP-1' },
    { name: 'bracket 6" long', part_number: 'SP-2' },
  ]));
  const lines = csv.trimEnd().split('\r\n');
  // Row order follows "still to answer first", so match on content rather than position.
  assert.equal(lines.length, 3, 'header plus two rows, however punctuated');
  assert.ok(csv.includes('"GBP-600, GREASE BUCKET 6KG DURELO"'), 'the comma is quoted, not read as a new column');
  assert.ok(csv.includes('"bracket 6"" long"'), 'a quote is doubled, not dropped');
});

test('the file starts with a marker so Excel reads rupees and Hindi correctly', () => {
  assert.equal(worksheetToCsv([]).charCodeAt(0), 0xfeff);
});

test('the header row names every column, in order', () => {
  const csv = worksheetToCsv([]);
  assert.equal(csv.slice(1).split('\r\n')[0], 'Name,Part No,OEM No,Brand,Category,Compatibility,Stock,Old label');
});

test('the filename says which company and which day', () => {
  assert.equal(worksheetFileName('Jai Durga Enterprises', '2026-09-04'), 'parts-worksheet-jai-durga-enterprises-2026-09-04.csv');
  assert.equal(worksheetFileName('bkgkj', '2026-09-04'), 'parts-worksheet-bkgkj-2026-09-04.csv');
  assert.equal(worksheetFileName('', '2026-09-04'), 'parts-worksheet-company-2026-09-04.csv');
  assert.equal(worksheetFileName('!!!', '2026-09-04'), 'parts-worksheet-company-2026-09-04.csv');
});
