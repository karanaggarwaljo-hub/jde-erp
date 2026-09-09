import assert from 'node:assert/strict';
import test from 'node:test';
import { averageMarginPercent, marginPercent } from '../lib/margin';

test('margin is worked out on the selling price, not on cost', () => {
  assert.equal(marginPercent(1000, 800), 20, 'a shop calls this 20%, not the 25% mark-up');
  assert.equal(marginPercent(1200, 600), 50);
});

test('selling at cost is a real answer of zero, not "unknown"', () => {
  assert.equal(marginPercent(800, 800), 0);
});

test('selling below cost reports the loss rather than hiding it', () => {
  assert.equal(marginPercent(800, 1000), -25);
});

/** The bug this module removes: the table printed 100% for any part with no cost recorded, while
 *  the average above it quietly skipped those same parts. Both now say "not known". */
test('a part with no cost recorded has no margin, rather than a fictional 100%', () => {
  assert.equal(marginPercent(1000, 0), null);
  assert.equal(marginPercent(1000, -5), null);
  assert.equal(marginPercent(1000, NaN), null);
});

test('a part with no selling price has no margin either', () => {
  assert.equal(marginPercent(0, 800), null);
  assert.equal(marginPercent(NaN, 800), null);
});

// ── Across the shelf ─────────────────────────────────────────────────────────────────────────

const sale = (p: { sale: number; cost: number }) => p.sale;
const cost = (p: { sale: number; cost: number }) => p.cost;

test('the average counts only the parts that have a margin', () => {
  const parts = [
    { sale: 1000, cost: 800 },  // 20%
    { sale: 1200, cost: 600 },  // 50%
    { sale: 1000, cost: 0 },    // no cost recorded — must not count as 100%
  ];
  assert.equal(averageMarginPercent(parts, sale, cost), 35, 'the mean of 20 and 50');
});

test('a shelf where nothing has a margin reports nothing, not zero', () => {
  const parts = [{ sale: 1000, cost: 0 }, { sale: 0, cost: 500 }];
  assert.equal(averageMarginPercent(parts, sale, cost), null,
    'zero would read as "we earn nothing", which is a different and wrong claim');
});

test('an empty shelf reports nothing', () => {
  assert.equal(averageMarginPercent([], sale, cost), null);
});

test('a loss-making part drags the average down rather than being skipped', () => {
  const parts = [{ sale: 1000, cost: 800 }, { sale: 800, cost: 1000 }];
  assert.equal(averageMarginPercent(parts, sale, cost), -2.5);
});
