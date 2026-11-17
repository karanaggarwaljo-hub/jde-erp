/**
 * Renders the two upload windows and reads the markup back, the same way sale-entry-render does:
 * the project has no DOM test runner, so this proves they render at all and that the words the
 * owner acts on — how many parts change, what the one button will do — follow the plan.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StockSheetModal, { type StockSheetModalProps } from '../components/inventory/StockSheetModal';
import UploadListModal from '../components/inventory/UploadListModal';
import type { ImportedProduct } from '../lib/client-import';
import type { SheetProduct } from '../lib/stock-sheet';

const PARTS: SheetProduct[] = [
  { id: '1', part_number: 'P-1', other_numbers: [], oem_number: '', brand: 'JCB', name: 'Fuel filter', cost_price: 800, sale_price: 1000, mrp: 1200, current_stock: 5 },
  { id: '2', part_number: 'P-2', other_numbers: [], oem_number: '', brand: 'JCB', name: 'Pin', cost_price: 120, sale_price: 150, mrp: 0, current_stock: 3 },
];

function row(extra: Partial<ImportedProduct>): ImportedProduct {
  return {
    part_number: '', oem_number: '', hsn_code: '', name: '', brand: '', category: '', compatibility: '',
    cost_price: 0, mrp: 0, sale_price: 0, current_stock: 0, min_stock: 0, location: '',
    given: { stock: extra.current_stock !== undefined, cost: (extra.cost_price ?? 0) > 0, sale: (extra.sale_price ?? 0) > 0, mrp: (extra.mrp ?? 0) > 0 },
    ...extra,
  };
}

function render(rows: ImportedProduct[], overrides: Partial<StockSheetModalProps> = {}) {
  return renderToStaticMarkup(createElement(StockSheetModal, {
    fileName: 'list.csv', rows, guessedFields: [], products: PARTS, companyName: 'Test Motors',
    saving: false, progress: { done: 0, total: 0 }, error: '',
    onCancel: () => {}, onSomethingElse: () => {}, onSave: () => {},
    ...overrides,
  }));
}

test('the window opens on what the file does, and the button says the same', () => {
  const markup = render([
    row({ part_number: 'P-1', name: 'Fuel filter', sale_price: 1100, current_stock: 9 }),
    row({ part_number: 'P-2', name: 'Pin', sale_price: 150, current_stock: 3 }),
    row({ part_number: 'NEW-1', name: 'Wiper blade', sale_price: 220, current_stock: 15 }),
  ]);
  assert.match(markup, /<strong>1<\/strong><span>part to update<\/span>/);
  assert.match(markup, /<strong>1<\/strong><span>new part to add<\/span>/);
  assert.match(markup, /<strong>1<\/strong><span>already the same<\/span>/);
  assert.match(markup, /Update 1 part and add 1 new/);
  // The change itself is spelt out, old figure then new.
  assert.match(markup, /₹1,000/);
  assert.match(markup, /₹1,100/);
  assert.match(markup, /New part/);
});

test('only the figures the file carries are offered', () => {
  const markup = render([row({ part_number: 'P-1', sale_price: 1100 })]);
  assert.match(markup, /Sale price/);
  assert.doesNotMatch(markup, /set to the number in the file/);
  assert.doesNotMatch(markup, />MRP</);
});

test('a row that cannot be placed is shown with its reason and no tick box of its own', () => {
  const twoBrands: SheetProduct[] = [
    { ...PARTS[0], id: '10', part_number: 'F-100', brand: 'JCB' },
    { ...PARTS[0], id: '11', part_number: 'F-100', brand: 'Fleetguard' },
  ];
  const markup = render([row({ part_number: 'F-100', name: 'Air filter', sale_price: 500 })], { products: twoBrands });
  assert.match(markup, /Left alone: 2 parts share this part number/);
  assert.match(markup, /Nothing to save/);
  assert.doesNotMatch(markup, /aria-label="Include Air filter"/);
});

test('setting stock to zero is called out before the button is pressed', () => {
  const markup = render([row({ part_number: 'P-1', current_stock: 0 })]);
  assert.match(markup, /will be set to <strong>0 in stock<\/strong>/);
});

test('guessed columns are owned up to', () => {
  const markup = render([row({ part_number: 'P-1', sale_price: 1100 })], { guessedFields: ['selling price'] });
  assert.match(markup, /did not clearly say which column is the selling price/);
});

test('a file with no stock or price says so and points at the other jobs', () => {
  const bare = row({ part_number: 'P-1', name: 'Fuel filter' });
  bare.given = {};
  const markup = render([bare]);
  assert.match(markup, /No stock or price column could be read/);
  assert.match(markup, /Do something else with this file/);
});

test('while saving, the button counts and nothing can be changed', () => {
  const markup = render([row({ part_number: 'P-1', sale_price: 1100 })], { saving: true, progress: { done: 2, total: 5 } });
  assert.match(markup, /Saving 2 of 5…/);
});

test('the upload window offers the list to start from and one place to choose a file', () => {
  const markup = renderToStaticMarkup(createElement(UploadListModal, {
    partCount: 258, reading: false, error: '', accept: '.csv,.xlsx',
    onFile: () => {}, onDownload: () => {}, onClose: () => {},
  }));
  assert.match(markup, /Download all 258 of your parts/);
  assert.match(markup, /Download my stock &amp; price list/);
  assert.equal((markup.match(/type="file"/g) ?? []).length, 1);
  assert.match(markup, /You will see every change before anything is saved/);
});
