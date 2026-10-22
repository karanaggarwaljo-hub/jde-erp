import assert from 'node:assert/strict';
import test from 'node:test';
import { addLine, addSuggestions, cleanQty, readSavedSheet, sheetSuppliers, sheetText, suggestedLines, type SheetLine } from '../lib/requirement-sheet';
import type { PartPlan } from '../lib/stock-planning';

const line = (partId: string, qty = 1, supplier = ''): SheetLine => ({ partId, partNumber: `PN-${partId}`, name: `part ${partId}`, qty, supplier });

/** The owner found the reorder screen too complicated; planning is now one list to add to and change. */
test('adding a part already on the sheet adds to its quantity instead of listing it twice', () => {
  const sheet = addLine([line('a', 2)], line('a', 3, 'Sharma'));
  assert.equal(sheet.length, 1);
  assert.equal(sheet[0].qty, 5);
  assert.equal(sheet[0].supplier, 'Sharma');
  assert.equal(addLine(sheet, line('b')).length, 2);
});

test('suggestions fill in only what is not on the sheet, and keep the quantities the owner set', () => {
  const sheet = addSuggestions([line('a', 9)], [line('a', 2), line('b', 4)]);
  assert.deepEqual(sheet.map((l) => [l.partId, l.qty]), [['a', 9], ['b', 4]]);
});

test('a suggested line orders at least one, from the supplier it was last bought from', () => {
  const plan = { partId: 'x', partNumber: '911', name: 'pin', suggestQty: 0, lastSupplier: null } as unknown as PartPlan;
  assert.deepEqual(suggestedLines([plan]), [{ partId: 'x', partNumber: '911', name: 'pin', qty: 1, supplier: '' }]);
});

test('quantities are whole pieces, at least one', () => {
  assert.equal(cleanQty(0), 1);
  assert.equal(cleanQty(-4), 1);
  assert.equal(cleanQty('3.6'), 4);
  assert.equal(cleanQty('abc'), 1);
});

test('the sheet as a message: heading, numbered lines with part numbers, and a total', () => {
  const text = sheetText({ company: 'Jai Durga Enterprises', date: '22-Oct-2026', supplier: 'Sharma', lines: [line('a', 2), { ...line('b', 3), partNumber: '' }] });
  assert.equal(text, '*Requirement - Jai Durga Enterprises*\n22-Oct-2026\nFor: Sharma\n\n1. PN-a - part a - 2 pcs\n2. part b - 3 pcs\n\nTotal: 2 items, 5 pcs');
});

test('suppliers are listed by name with "no supplier" last; a bad saved sheet reads as none', () => {
  assert.deepEqual(sheetSuppliers([line('a', 1, 'Zed'), line('b'), line('c', 1, 'Amar'), line('d', 1, 'Zed')]), ['Amar', 'Zed', '']);
  assert.equal(readSavedSheet('not json'), null);
  assert.equal(readSavedSheet('{"a":1}'), null);
  assert.deepEqual(readSavedSheet(JSON.stringify([line('a', 0), { junk: true }])), [line('a', 1)]);
});
