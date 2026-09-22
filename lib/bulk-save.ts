/**
 * Saving a list of parts from an import, a few at a time.
 *
 * One at a time, a 26-part import sat through 26 round trips in a row, and each save is several
 * database calls — who is signed in, the part as it was, the change, the audit entry — about three
 * seconds apiece. A few at once is several times faster and still light on the database.
 *
 * Only different items overlap; each item's own steps stay in order. So this is only for a list in
 * which no two items touch the same part, which the import plans guarantee: two rows pointing at
 * one part, or at one part number, are held back before anything is offered.
 */

/** How many parts an import saves at once: enough to cut the wait several-fold, few enough to stay
 *  light on the database. Each save is still its own complete, audited edit. */
export const IMPORT_SAVES_AT_ONCE = 4;

export type SaveEachResult =
  | { done: number; failed: false }
  | { done: number; failed: true; error: unknown };

/**
 * Runs `save` for every item, at most `concurrency` at once, calling `onSaved` with the running
 * count after each success.
 *
 * At the first failure no new saves start; the ones already under way finish and are counted if
 * they succeed. `done` is therefore exactly how many were saved — the number the owner is told when
 * a run stops partway, so they know its true shape.
 */
export async function saveEach<T>(
  items: readonly T[],
  save: (item: T) => Promise<unknown>,
  { concurrency, onSaved }: { concurrency: number; onSaved?: (done: number) => void }
): Promise<SaveEachResult> {
  let next = 0;
  let done = 0;
  const failures: unknown[] = [];

  const worker = async () => {
    while (failures.length === 0 && next < items.length) {
      const item = items[next];
      next += 1;
      try {
        await save(item);
        done += 1;
        onSaved?.(done);
      } catch (error) {
        failures.push(error);
      }
    }
  };

  const workers = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return failures.length === 0 ? { done, failed: false } : { done, failed: true, error: failures[0] };
}
