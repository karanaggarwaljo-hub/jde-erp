import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {
  SPREADSHEET_ACCEPT,
  SPREADSHEET_EXTENSIONS,
  isSpreadsheetFileName,
  readSheetForCostUpdate,
  parseInventoryFile,
} from '../lib/client-import';

const ROWS = [
  ['Part No', 'Name', 'Qty available', 'Cost Price'],
  ['HYD-P01', 'Hydraulic Pump', 4, 19200],
  ['GRE-G02', 'Greas gun 1kg', 16, 650],
];

function bookAs(bookType: XLSX.BookType, name: string): File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(ROWS), 'Sheet1');
  const buffer = XLSX.write(workbook, { type: 'array', bookType }) as ArrayBuffer;
  return new File([buffer], name);
}

/** Every format the picker offers must genuinely be readable — that pairing is the whole point of
 *  deriving the accept list from this array, and it is what broke before: the picker offered three
 *  formats while the reader handled far more, so readable files were greyed out in the dialog. */
const READABLE: Array<[string, XLSX.BookType]> = [
  ['.xlsx', 'xlsx'],
  ['.xlsm', 'xlsm'],
  ['.xlsb', 'xlsb'],
  ['.ods', 'ods'],
  ['.fods', 'fods'],
  ['.csv', 'csv'],
  ['.txt', 'txt'],
  ['.dif', 'dif'],
];

for (const [extension, bookType] of READABLE) {
  test(`reads a ${extension} workbook, so offering it in the picker is honest`, async () => {
    const file = bookAs(bookType, `book${extension}`);

    const sheet = await readSheetForCostUpdate(file);
    assert.equal(sheet.suggestedCostColumn, 'Cost Price', `${extension}: cost column`);
    assert.ok(sheet.columns.includes('Part No'), `${extension}: columns ${sheet.columns.join(', ')}`);

    const { products } = await parseInventoryFile(file);
    assert.equal(products.length, 2, `${extension}: parts parsed`);

    assert.ok(isSpreadsheetFileName(file.name), `${extension}: must not be rejected on its name`);
  });
}

test('the picker offers exactly the extensions the app claims to support', () => {
  assert.equal(SPREADSHEET_ACCEPT, SPREADSHEET_EXTENSIONS.join(','));
  // The three that were offered before must still be, and the common misses must now be too.
  for (const extension of ['.csv', '.xls', '.xlsx', '.xlsm', '.ods']) {
    assert.ok(SPREADSHEET_EXTENSIONS.includes(extension), `${extension} should be offered`);
  }
});

test('accepts a file whatever the case of its extension', () => {
  assert.ok(isSpreadsheetFileName('PRICE LIST.XLSX'));
  assert.ok(isSpreadsheetFileName('inv(Sheet1).CSV'));
  assert.ok(isSpreadsheetFileName('stock.Xlsm'));
});

test('a name with dots or spaces in it is judged on the real extension', () => {
  assert.ok(isSpreadsheetFileName('inv(Sheet1).csv'));
  assert.ok(isSpreadsheetFileName('2026.08 price list v2.xlsx'));
  assert.ok(!isSpreadsheetFileName('report.xlsx.pdf'));
});

test('rejects what it genuinely cannot read, so the message can say what to do instead', () => {
  for (const name of ['invoice.pdf', 'photo.jpg', 'notes.docx', 'archive.zip', 'noextension']) {
    assert.ok(!isSpreadsheetFileName(name), `${name} should be refused`);
  }
});
