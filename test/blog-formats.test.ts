/**
 * Article formats (lib/blog-formats.ts): every new post is written in a different format from the
 * last ones, and every format comes round before any repeats.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_FORMAT, FORMATS, formatById, formatLabel, isFormat, machineAndFormat, nextFormat } from '../lib/blog-formats';

test('every format has an id, a label, a hint and a layout for the writer', () => {
  const ids = FORMATS.map((format) => format.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  assert.ok(FORMATS.length >= 8, 'enough formats that posts do not soon repeat');
  for (const format of FORMATS) {
    assert.match(format.id, /^[a-z]{1,30}$/, 'what scripts/blog-formats.sql allows');
    assert.ok(format.label.length > 2 && format.label.length <= 40, format.id);
    assert.ok(format.hint.length > 5, format.id);
    assert.ok(format.structure.length > 80, format.id);
    assert.doesNotMatch(format.structure, /price list|₹|rupees/i, 'no format asks for prices');
  }
  assert.equal(DEFAULT_FORMAT, 'guide');
  assert.ok(isFormat('checklist'));
  assert.equal(isFormat('Checklist'), false);
  assert.equal(isFormat(undefined), false);
});

test('the formats that need checklists and tables ask for them in the form the article reader knows', () => {
  for (const id of ['checklist', 'buyers']) assert.match(formatById(id).structure, /"- \[ \] "/, id);
  for (const id of ['checklist', 'troubleshoot', 'compare']) assert.match(formatById(id).structure, /table/, id);
  assert.match(formatById('troubleshoot').structure, /\| Symptom \| Likely causes \| What to check first \|/);
  assert.match(formatById('myths').structure, /> \*\*Fact:\*\*/);
});

test('a post from before formats, or an unknown format, reads as a plain guide', () => {
  assert.equal(formatLabel(null), 'Complete guide');
  assert.equal(formatLabel('nonsense'), 'Complete guide');
  assert.equal(formatLabel('myths'), 'Myths and facts');
  assert.equal(machineAndFormat('Backhoe loader', 'checklist'), 'Backhoe loader · Checklist');
  assert.equal(machineAndFormat('Backhoe loader', 'guide'), 'Backhoe loader');
  assert.equal(machineAndFormat('Excavator', undefined), 'Excavator');
});

test('the next format is one the recent posts have not used', () => {
  // Nothing written yet: any format, chosen at random.
  assert.equal(nextFormat([], () => 0), FORMATS[0].id);
  assert.equal(nextFormat([], () => 0.9999), FORMATS[FORMATS.length - 1].id);
  // The existing post was a guide: the next is anything but a guide, whatever the dice say.
  for (const roll of [0, 0.3, 0.6, 0.9999]) assert.notEqual(nextFormat(['guide'], () => roll), 'guide');
  // Entries that are not formats (older posts, missing values) are skipped.
  assert.notEqual(nextFormat([null, 'nonsense', 'checklist'], () => 0), 'checklist');
});

test('once every format is used, the one used longest ago comes next', () => {
  const newestFirst = ['tips', 'myths', 'steps', 'compare', 'buyers', 'explainer', 'mistakes', 'troubleshoot', 'checklist', 'guide', 'tips'];
  assert.equal(nextFormat(newestFirst), 'guide');
  assert.equal(nextFormat(['guide', ...newestFirst]), 'checklist');
});

test('writing post after post, no two in a row match and every format comes round before a repeat', () => {
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const written: string[] = [];
  for (let n = 0; n < FORMATS.length * 4; n += 1) written.unshift(nextFormat(written, random));
  const inOrder = [...written].reverse();
  for (let n = 1; n < inOrder.length; n += 1) assert.notEqual(inOrder[n], inOrder[n - 1], `post ${n} repeats the one before`);
  for (let start = 0; start + FORMATS.length <= inOrder.length; start += FORMATS.length) {
    assert.equal(new Set(inOrder.slice(start, start + FORMATS.length)).size, FORMATS.length, `round starting at post ${start} uses every format once`);
  }
});
