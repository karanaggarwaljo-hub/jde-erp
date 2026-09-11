import assert from 'node:assert/strict';
import test from 'node:test';
import { describeCodeClashes, findCodeClashes } from '../lib/import-part-codes';

const part = (code?: string) => ({ part_number: code, name: 'something' });

test('a clean file has no clashes', () => {
  assert.deepEqual(findCodeClashes([part('A-1'), part('A-2')], ['B-1']), []);
});

/** The failure this prevents: importing a code already on the shelf used to create a second part
 *  answering to it, which is how five different things came to share SP-239. */
test('a code already used by a part in this company is a clash', () => {
  assert.deepEqual(findCodeClashes([part('SP-239')], ['SP-239']), [
    { code: 'sp-239', where: 'inventory', rows: [2] },
  ]);
});

test('the same code twice in one file is a clash even when nothing has it yet', () => {
  assert.deepEqual(findCodeClashes([part('A-1'), part('B-1'), part('A-1')], []), [
    { code: 'a-1', where: 'file', rows: [2, 4] },
  ]);
});

test('case and surrounding spaces do not make two codes different', () => {
  assert.deepEqual(findCodeClashes([part(' sp-239 ')], ['SP-239']), [
    { code: 'sp-239', where: 'inventory', rows: [2] },
  ]);
});

/** Plenty of real parts have no code at all. Those are given one when they are created. */
test('blank codes are never clashes, however many there are', () => {
  assert.deepEqual(findCodeClashes([part(''), part(undefined), part('   ')], ['']), []);
});

test('a code that clashes both ways is reported against inventory, which is the harder one to find', () => {
  assert.deepEqual(findCodeClashes([part('A-1'), part('A-1')], ['A-1']), [
    { code: 'a-1', where: 'inventory', rows: [2, 3] },
  ]);
});

test('row numbers count the header, the way the spreadsheet does', () => {
  const clashes = findCodeClashes([part('X'), part('Y'), part('X')], []);
  assert.deepEqual(clashes[0].rows, [2, 4], 'the first data row is row 2');
});

test('an empty file imports nothing and clashes with nothing', () => {
  assert.deepEqual(findCodeClashes([], ['A-1']), []);
});

// ── What the owner is told ───────────────────────────────────────────────────────────────────

test('nothing to say when nothing clashed', () => {
  assert.equal(describeCodeClashes([]), '');
});

test('the message names the code, where it clashes, and what to do', () => {
  const message = describeCodeClashes(findCodeClashes([part('sp-239')], ['SP-239']));
  assert.match(message, /SP-239/);
  assert.match(message, /row 2/);
  assert.match(message, /already used by a part you have/);
  assert.match(message, /Nothing was imported/, 'the owner has to know the file did not half-land');
});

test('a file that repeats itself says which rows', () => {
  const message = describeCodeClashes(findCodeClashes([part('X'), part('X')], []));
  assert.match(message, /rows 2, 3 of the file/);
});

/** A hundred clashes must not produce a hundred-line error nobody reads. */
test('a long list is cut short and counted', () => {
  const rows = Array.from({ length: 9 }, (_, i) => part(`CODE-${i}`));
  const message = describeCodeClashes(findCodeClashes(rows, rows.map((r) => r.part_number as string)));
  assert.match(message, /and 4 more/);
});
