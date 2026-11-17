/**
 * An uploaded stock and price list overwrites real stock counts and real prices for many parts at
 * once. What it would do is decided in lib/stock-sheet.ts and checked here before any of it is
 * ever written: which rows update, which add, which are left alone, and that an empty cell can
 * never set anything to zero.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseInventoryFile, readNumberCell, type ImportedProduct } from '../lib/client-import';
import {
  countSheetOutcomes,
  describeSheetAction,
  fieldsInSheet,
  planSheetUpdate,
  priceListCsv,
  priceListFileName,
  sheetSaveSteps,
  type SheetField,
  type SheetProduct,
} from '../lib/stock-sheet';

const ALL: ReadonlySet<SheetField> = new Set(['stock', 'cost', 'sale', 'mrp']);

function product(id: string, extra: Partial<SheetProduct> = {}): SheetProduct {
  return {
    id, part_number: `P-${id}`, other_numbers: [], oem_number: '', brand: 'JCB', name: `Part ${id}`,
    cost_price: 800, sale_price: 1000, mrp: 1200, current_stock: 5, ...extra,
  };
}

function row(extra: Partial<ImportedProduct> = {}): ImportedProduct {
  const merged: ImportedProduct = {
    part_number: '', oem_number: '', hsn_code: '', name: '', brand: '', category: '', compatibility: '',
    cost_price: 0, mrp: 0, sale_price: 0, current_stock: 0, min_stock: 0, location: '', ...extra,
  };
  // Unless a test says otherwise, a figure counts as given when the row was built with one.
  if (!extra.given) {
    merged.given = {
      stock: extra.current_stock !== undefined,
      cost: (extra.cost_price ?? 0) > 0,
      sale: (extra.sale_price ?? 0) > 0,
      mrp: (extra.mrp ?? 0) > 0,
    };
  }
  return merged;
}

const FILTER = product('1');
const PIN = product('2', { name: 'Pin', cost_price: 120, sale_price: 150, mrp: 0, current_stock: 0 });

test('a spreadsheet cell is read as a figure only when it holds one', () => {
  assert.equal(readNumberCell(1250), 1250);
  assert.equal(readNumberCell('1,250.50'), 1250.5);
  assert.equal(readNumberCell('₹ 1,250'), 1250);
  assert.equal(readNumberCell('Rs. 40'), 40);
  assert.equal(readNumberCell(0), 0);
  assert.equal(readNumberCell('0'), 0);
  for (const junk of ['', '  ', 'N/A', 'call', '-3', -3, null, undefined, Number.NaN]) {
    assert.equal(readNumberCell(junk), null, `${String(junk)} must not read as a figure`);
  }
});

test('a row for a part already here updates only the figures that differ', () => {
  const [plan] = planSheetUpdate(
    [row({ part_number: 'P-1', name: 'Part 1', cost_price: 850, sale_price: 1000, current_stock: 9 })],
    [FILTER, PIN], ALL
  );
  assert.equal(plan.outcome, 'update');
  assert.equal(plan.product?.id, '1');
  assert.equal(plan.matchedBy, 'part number');
  assert.deepEqual(plan.changes, [
    { field: 'stock', from: 5, to: 9 },
    { field: 'cost', from: 800, to: 850 },
  ]);
});

test('an empty cell never sets a price or a stock count to zero', () => {
  // A price list with no stock column and a blank MRP: given says neither was there.
  const [plan] = planSheetUpdate(
    [row({ part_number: 'P-1', sale_price: 1100, given: { sale: true } })],
    [FILTER], ALL
  );
  assert.deepEqual(plan.changes, [{ field: 'sale', from: 1000, to: 1100 }]);
});

test('a row built without given marks updates nothing at all', () => {
  const bare = row({ part_number: 'P-1', sale_price: 1100, current_stock: 0 });
  delete bare.given;
  const [plan] = planSheetUpdate([bare], [FILTER], ALL);
  assert.equal(plan.outcome, 'same');
  assert.equal(plan.reason, 'no stock or price on this row');
});

test('a stock of zero that the file really says is a change', () => {
  const [plan] = planSheetUpdate([row({ part_number: 'P-1', current_stock: 0 })], [FILTER], ALL);
  assert.deepEqual(plan.changes, [{ field: 'stock', from: 5, to: 0 }]);
});

test('unticking a figure for the whole file leaves that figure alone on every part', () => {
  const rows = [row({ part_number: 'P-1', cost_price: 850, sale_price: 1100, current_stock: 50 })];
  const [plan] = planSheetUpdate(rows, [FILTER], new Set<SheetField>(['cost', 'sale']));
  assert.deepEqual(plan.changes.map((change) => change.field), ['cost', 'sale']);
  // And with only stock unticked and nothing else differing, the row has nothing to do.
  const [quiet] = planSheetUpdate([row({ part_number: 'P-1', current_stock: 50 })], [FILTER], new Set<SheetField>(['cost', 'sale']));
  assert.equal(quiet.outcome, 'same');
});

test('a row matching nothing becomes a new part', () => {
  const [plan] = planSheetUpdate([row({ part_number: 'NEW-9', name: 'Brand new seal', sale_price: 40, current_stock: 3 })], [FILTER], ALL);
  assert.equal(plan.outcome, 'new');
  assert.equal(plan.product, undefined);
});

test('a part is found by its name when the file has no number, and by any of its other numbers', () => {
  const withOther = product('7', { other_numbers: ['32/925694'] });
  const plans = planSheetUpdate(
    [row({ name: 'pin', sale_price: 160 }), row({ part_number: '32-925694', sale_price: 990 })],
    [PIN, withOther], ALL
  );
  assert.equal(plans[0].product?.id, '2');
  assert.equal(plans[0].matchedBy, 'name');
  assert.equal(plans[1].product?.id, '7');
  assert.equal(plans[1].matchedBy, 'other number');
});

test('one number kept in two brands is settled by the brand on the row, and never guessed', () => {
  const jcb = product('10', { part_number: 'F-100', brand: 'JCB' });
  const fleet = product('11', { part_number: 'F-100', brand: 'Fleetguard' });

  const [named] = planSheetUpdate([row({ part_number: 'F-100', brand: 'fleetguard', sale_price: 700 })], [jcb, fleet], ALL);
  assert.equal(named.outcome, 'update');
  assert.equal(named.product?.id, '11');

  const [unnamed] = planSheetUpdate([row({ part_number: 'F-100', sale_price: 700 })], [jcb, fleet], ALL);
  assert.equal(unnamed.outcome, 'unclear');
  assert.match(unnamed.reason ?? '', /Add a Brand column/);

  const [third] = planSheetUpdate([row({ part_number: 'F-100', brand: 'Mahle', sale_price: 700 })], [jcb, fleet], ALL);
  assert.equal(third.outcome, 'unclear');
});

test('a number already here in another brand is not added as a second part with that number', () => {
  const [plan] = planSheetUpdate([row({ part_number: 'P-1', brand: 'Mahle', name: 'Part 1', sale_price: 900 })], [FILTER], ALL);
  assert.equal(plan.outcome, 'unclear');
  assert.match(plan.reason ?? '', /Add another brand/);
});

test('the same name in another brand, with its own number, is simply a new part', () => {
  const [plan] = planSheetUpdate([row({ part_number: 'MH-55', brand: 'Mahle', name: 'Part 1', sale_price: 900 })], [FILTER], ALL);
  assert.equal(plan.outcome, 'new');
});

test('a part on file with no brand is still the part a branded row means', () => {
  const unbranded = product('12', { brand: '' });
  const [plan] = planSheetUpdate([row({ part_number: 'P-12', brand: 'JCB', sale_price: 900 })], [unbranded], ALL);
  assert.equal(plan.outcome, 'update');
});

test('two rows giving one part different figures are both left alone', () => {
  const plans = planSheetUpdate(
    [row({ part_number: 'P-1', sale_price: 1100 }), row({ part_number: 'P-1', sale_price: 1150 })],
    [FILTER], ALL
  );
  assert.deepEqual(plans.map((plan) => plan.outcome), ['unclear', 'unclear']);
  assert.match(plans[0].reason ?? '', /rows 1, 2 give different figures/);
  assert.deepEqual(plans[0].changes, []);
});

test('the same row twice is applied once', () => {
  const plans = planSheetUpdate(
    [row({ part_number: 'P-1', sale_price: 1100 }), row({ part_number: 'P-1', sale_price: 1100 })],
    [FILTER], ALL
  );
  assert.deepEqual(plans.map((plan) => plan.outcome), ['update', 'same']);
  assert.equal(plans[1].reason, 'same part as row 1');
});

test('two new rows sharing a part number are not both added', () => {
  const plans = planSheetUpdate(
    [row({ part_number: 'NEW-1', name: 'Seal', sale_price: 40 }), row({ part_number: 'new 1', name: 'Seal kit', sale_price: 90 })],
    [FILTER], ALL
  );
  assert.deepEqual(plans.map((plan) => plan.outcome), ['new', 'unclear']);
  assert.match(plans[1].reason ?? '', /same part number as row 1/);
});

test('counts and the button wording follow the plan', () => {
  const plans = planSheetUpdate(
    [
      row({ part_number: 'P-1', sale_price: 1100 }),
      row({ part_number: 'P-2', sale_price: 150 }),
      row({ part_number: 'NEW-1', name: 'Seal', sale_price: 40 }),
    ],
    [FILTER, PIN], ALL
  );
  assert.deepEqual(countSheetOutcomes(plans), { update: 1, same: 1, new: 1, unclear: 0 });
  assert.equal(describeSheetAction(1, 1), 'Update 1 part and add 1 new');
  assert.equal(describeSheetAction(38, 0), 'Update 38 parts');
  assert.equal(describeSheetAction(0, 5), 'Add 5 new parts');
  assert.equal(describeSheetAction(0, 0), 'Nothing to save');
});

test('only the figures a file carries are offered as tick boxes', () => {
  assert.deepEqual(fieldsInSheet([row({ part_number: 'P-1', sale_price: 1100 })]), ['sale']);
  assert.deepEqual(fieldsInSheet([row({ part_number: 'P-1', cost_price: 5, current_stock: 2 }), row({ mrp: 9 })]), ['stock', 'cost', 'mrp']);
});

test('an updated part saves the way its Edit form would', () => {
  const [prices] = planSheetUpdate([row({ part_number: 'P-1', cost_price: 850, sale_price: 1100, mrp: 1300 })], [FILTER], ALL);
  assert.deepEqual(sheetSaveSteps(prices), {
    partId: '1', patch: { cost_price: 850, sale_price: 1100, mrp: 1300 }, correctCost: 850,
  });
  const [stock] = planSheetUpdate([row({ part_number: 'P-1', current_stock: 12 })], [FILTER], ALL);
  assert.deepEqual(sheetSaveSteps(stock), { partId: '1', setStock: { target: 12, unitCost: 800 } });
  const [both] = planSheetUpdate([row({ part_number: 'P-1', cost_price: 850, current_stock: 12 })], [FILTER], ALL);
  assert.deepEqual(sheetSaveSteps(both), { partId: '1', patch: { cost_price: 850 }, setStock: { target: 12, unitCost: 850 } });
  const [fresh] = planSheetUpdate([row({ part_number: 'NEW-1', name: 'Seal', sale_price: 40 })], [FILTER], ALL);
  assert.equal(sheetSaveSteps(fresh), null);
});

test('the list this app writes comes straight back with nothing to change, and a changed cell is one update', async () => {
  const parts = [FILTER, PIN, product('3', { name: 'Hose, "braided" 3/4', brand: 'Parker', cost_price: 0, sale_price: 0, mrp: 0, current_stock: 2 })];
  const csv = priceListCsv(parts);
  assert.ok(csv.startsWith('﻿'), 'Excel needs the BOM to read it as UTF-8');

  const untouched = await parseInventoryFile(new File([csv], 'list.csv', { type: 'text/csv' }));
  assert.equal(untouched.guessedFields.length, 0, 'every heading must be recognised without guessing');
  assert.equal(untouched.products.length, 3);
  const quiet = planSheetUpdate(untouched.products, parts, ALL);
  assert.deepEqual(countSheetOutcomes(quiet), { update: 0, same: 3, new: 0, unclear: 0 });

  // The owner raises one sale price and recounts one shelf.
  const edited = csv.replace('P-1,Part 1,JCB,,5,800,1000,1200', 'P-1,Part 1,JCB,,7,800,1150,1200');
  assert.notEqual(edited, csv);
  const changed = await parseInventoryFile(new File([edited], 'list.csv', { type: 'text/csv' }));
  const plans = planSheetUpdate(changed.products, parts, ALL);
  assert.deepEqual(countSheetOutcomes(plans), { update: 1, same: 2, new: 0, unclear: 0 });
  const update = plans.find((plan) => plan.outcome === 'update');
  assert.deepEqual(update?.changes, [
    { field: 'stock', from: 5, to: 7 },
    { field: 'sale', from: 1000, to: 1150 },
  ]);
});

test('the downloaded list is named for its company and day', () => {
  assert.equal(priceListFileName('Jai Durga Enterprises', '2026-11-14'), 'stock-and-prices-jai-durga-enterprises-2026-11-14.csv');
  assert.equal(priceListFileName('', '2026-11-14'), 'stock-and-prices-company-2026-11-14.csv');
});
