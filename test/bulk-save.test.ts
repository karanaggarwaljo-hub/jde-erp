import assert from 'node:assert/strict';
import test from 'node:test';
import { saveEach } from '../lib/bulk-save';

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('saves every item, never more than the limit at once, counting each one as it lands', async () => {
  let running = 0;
  let mostAtOnce = 0;
  const saved: number[] = [];
  const progress: number[] = [];
  const result = await saveEach(
    Array.from({ length: 26 }, (_, i) => i),
    async (item) => {
      running += 1;
      mostAtOnce = Math.max(mostAtOnce, running);
      await tick();
      saved.push(item);
      running -= 1;
    },
    { concurrency: 4, onSaved: (done) => progress.push(done) }
  );
  assert.deepEqual(result, { done: 26, failed: false });
  assert.equal(mostAtOnce, 4);
  assert.deepEqual([...saved].sort((a, b) => a - b), Array.from({ length: 26 }, (_, i) => i));
  // The count only ever goes up, one at a time, and ends at the number there were to begin with.
  assert.deepEqual(progress, Array.from({ length: 26 }, (_, i) => i + 1));
});

test('one at a time keeps the order of the file', async () => {
  const saved: string[] = [];
  await saveEach(['a', 'b', 'c'], async (item) => { await tick(); saved.push(item); }, { concurrency: 1 });
  assert.deepEqual(saved, ['a', 'b', 'c']);
});

test('after a failure nothing new starts, saves already under way finish, and the count is exact', async () => {
  const started: number[] = [];
  const result = await saveEach(
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    async (item) => {
      started.push(item);
      if (item === 0) throw new Error('duplicate part number');
      await tick();
    },
    { concurrency: 3 }
  );
  assert.equal(result.failed, true);
  assert.equal(result.failed && (result.error as Error).message, 'duplicate part number');
  // 1 and 2 were already under way when 0 failed: they land and are counted, and nothing after
  // them is started.
  assert.deepEqual(started, [0, 1, 2]);
  assert.equal(result.done, 2);
});

test('an empty list saves nothing', async () => {
  let calls = 0;
  const result = await saveEach([], async () => { calls += 1; }, { concurrency: 4 });
  assert.deepEqual(result, { done: 0, failed: false });
  assert.equal(calls, 0);
});
