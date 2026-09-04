import assert from 'node:assert/strict';
import test from 'node:test';
import { rotateForFairShare } from '../lib/ai/generate';

const CHAIN = ['gemini', 'groq', 'cerebras'];
const pick = (index: number) => () => index;

test('rotating moves the starting point without dropping anyone', () => {
  assert.deepEqual(rotateForFairShare(CHAIN, { pick: pick(0) }), ['gemini', 'groq', 'cerebras']);
  assert.deepEqual(rotateForFairShare(CHAIN, { pick: pick(1) }), ['groq', 'cerebras', 'gemini']);
  assert.deepEqual(rotateForFairShare(CHAIN, { pick: pick(2) }), ['cerebras', 'gemini', 'groq']);
});

/** The whole point of only moving the START: a rotated-to provider that fails still falls
 *  through to the others, so spreading the load costs no reliability. */
test('every provider is still in the chain after rotating, so failover is unchanged', () => {
  for (let index = 0; index < CHAIN.length; index += 1) {
    const rotated = rotateForFairShare(CHAIN, { pick: pick(index) });
    assert.equal(rotated.length, CHAIN.length);
    assert.deepEqual([...rotated].sort(), [...CHAIN].sort());
  }
});

test('the order after the starting point is preserved, not shuffled', () => {
  const rotated = rotateForFairShare(['a', 'b', 'c', 'd'], { pick: pick(2) });
  assert.deepEqual(rotated, ['c', 'd', 'a', 'b']);
});

/** Short interactive asks lead with the fastest provider on purpose and use very little, so
 *  there is nothing worth spreading and a slower start would be felt immediately. */
test('quick interactive asks are never rotated', () => {
  assert.deepEqual(rotateForFairShare(CHAIN, { priority: 'speed', pick: pick(2) }), CHAIN);
});

test('heavy analysis is rotated, since that is what consumes an allowance', () => {
  assert.deepEqual(rotateForFairShare(CHAIN, { priority: 'quality', pick: pick(1) }), ['groq', 'cerebras', 'gemini']);
});

test('rotation can be switched off without changing anything else', () => {
  assert.deepEqual(rotateForFairShare(CHAIN, { rotate: false, pick: pick(2) }), CHAIN);
});

test('a single provider is left exactly as it is', () => {
  assert.deepEqual(rotateForFairShare(['groq'], { pick: pick(0) }), ['groq']);
  assert.deepEqual(rotateForFairShare([], { pick: pick(0) }), []);
});

/** A chooser returning nonsense must not silently drop providers off the chain. */
test('an out-of-range choice falls back to the original order', () => {
  for (const bad of [-1, 3, 99, 1.5, NaN]) {
    assert.deepEqual(rotateForFairShare(CHAIN, { pick: () => bad }), CHAIN, String(bad));
  }
});

test('over many requests the work is spread across every provider', () => {
  const counts = new Map<string, number>();
  for (let call = 0; call < 3000; call += 1) {
    const first = rotateForFairShare(CHAIN, { pick: (n) => Math.floor(Math.random() * n) })[0];
    counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  for (const provider of CHAIN) {
    const share = (counts.get(provider) ?? 0) / 3000;
    assert.ok(share > 0.25 && share < 0.42, `${provider} took ${(share * 100).toFixed(1)}% of first place`);
  }
});
