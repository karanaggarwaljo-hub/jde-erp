import type { CostUpdateRow } from './client-import';

/** Works out which existing part each row of a cost sheet refers to, and what would change.
 *
 *  Pure and side-effect free on purpose: this decides what a bulk overwrite of real cost prices
 *  would do, so it must be inspectable in a preview and testable on its own before anything is
 *  written. Nothing here touches the database.
 */

export type CostMatchProduct = {
  id: string;
  part_number: string;
  oem_number: string;
  name: string;
  cost_price: number;
};

export type CostMatchOutcome =
  /** Matched one part, and the cost differs — this is what gets written. */
  | 'update'
  /** Matched one part, but the cost is already the same — nothing to do. */
  | 'unchanged'
  /** No part in this company matches. Left alone; never created. */
  | 'not_found'
  /** Matched more than one part, or two rows disagree about the same part. Never guessed at. */
  | 'conflict';

export type CostMatch = {
  row: CostUpdateRow;
  outcome: CostMatchOutcome;
  product?: CostMatchProduct;
  matchedBy?: 'part number' | 'OEM number' | 'name';
  /** Plain-language explanation, shown as-is for anything that will not be applied. */
  reason?: string;
};

/** Part numbers are written inconsistently by hand and by suppliers — "JCB-H49", "jcb h49" and
 *  "JCBH49" are one part. Punctuation and case carry no meaning in a code, so drop both. */
const codeKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Names are prose, so only case and spacing are safe to normalise. Stripping punctuation here
 *  would merge genuinely different parts. */
const nameKey = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').trim();

function indexBy(products: CostMatchProduct[], pick: (p: CostMatchProduct) => string, key: (v: string) => string) {
  const map = new Map<string, CostMatchProduct[]>();
  for (const product of products) {
    const value = key(pick(product) ?? '');
    if (!value) continue;
    const bucket = map.get(value);
    if (bucket) bucket.push(product);
    else map.set(value, [product]);
  }
  return map;
}

export function planCostUpdates(rows: CostUpdateRow[], products: CostMatchProduct[]): CostMatch[] {
  const byPart = indexBy(products, (p) => p.part_number, codeKey);
  const byOem = indexBy(products, (p) => p.oem_number, codeKey);
  const byName = indexBy(products, (p) => p.name, nameKey);

  // Part number first, then OEM, then name: a code identifies a part far more reliably than a
  // description does, and two suppliers routinely describe the same part differently.
  const attempts: Array<{ label: CostMatch['matchedBy']; value: (r: CostUpdateRow) => string; index: Map<string, CostMatchProduct[]> }> = [
    { label: 'part number', value: (r) => codeKey(r.partNumber), index: byPart },
    { label: 'OEM number', value: (r) => codeKey(r.oemNumber), index: byOem },
    { label: 'name', value: (r) => nameKey(r.name), index: byName },
  ];

  const matches: CostMatch[] = rows.map((row) => {
    for (const attempt of attempts) {
      const key = attempt.value(row);
      if (!key) continue;
      const found = attempt.index.get(key);
      if (!found || found.length === 0) continue;
      if (found.length > 1) {
        return {
          row,
          outcome: 'conflict',
          matchedBy: attempt.label,
          reason: `matches ${found.length} different parts by ${attempt.label} — left alone`,
        };
      }
      const product = found[0];
      const same = Number(product.cost_price) === row.cost;
      return {
        row,
        outcome: same ? 'unchanged' : 'update',
        product,
        matchedBy: attempt.label,
        ...(same ? { reason: 'already this cost' } : {}),
      };
    }
    return { row, outcome: 'not_found', reason: 'no part in this company matches' };
  });

  // Two rows pointing at one part is a mistake in the sheet, not something to resolve by letting
  // whichever came last win silently.
  const byProduct = new Map<string, CostMatch[]>();
  for (const match of matches) {
    if (!match.product) continue;
    const bucket = byProduct.get(match.product.id);
    if (bucket) bucket.push(match);
    else byProduct.set(match.product.id, [match]);
  }

  for (const group of byProduct.values()) {
    if (group.length < 2) continue;
    const costs = new Set(group.map((m) => m.row.cost));
    if (costs.size > 1) {
      const rowNumbers = group.map((m) => m.row.rowNumber).join(', ');
      for (const match of group) {
        match.outcome = 'conflict';
        match.reason = `rows ${rowNumbers} give different costs for this part — left alone`;
      }
    } else {
      // Same cost repeated: apply it once, and say why the others did nothing.
      group.slice(1).forEach((match) => {
        match.outcome = 'unchanged';
        match.reason = `same part as row ${group[0].row.rowNumber}`;
      });
    }
  }

  return matches;
}

export type CostPlanCounts = Record<CostMatchOutcome, number>;

export function countOutcomes(matches: CostMatch[]): CostPlanCounts {
  const counts: CostPlanCounts = { update: 0, unchanged: 0, not_found: 0, conflict: 0 };
  for (const match of matches) counts[match.outcome] += 1;
  return counts;
}

/** Does this incoming row already exist in the inventory?
 *
 *  Used by the "add as new parts" side of the importer to flag rows that would create a second
 *  copy of something already stocked. Same keys and the same tolerance as the cost matcher above,
 *  so the two halves of one dialog can never disagree about whether a part is already there. */
export function findExistingProduct(
  products: CostMatchProduct[],
  candidate: { partNumber?: string; name?: string }
): CostMatchProduct | undefined {
  const partKey = codeKey(candidate.partNumber ?? '');
  if (partKey) {
    const byPart = products.find((p) => codeKey(p.part_number ?? '') === partKey);
    if (byPart) return byPart;
  }
  const label = nameKey(candidate.name ?? '');
  if (label) return products.find((p) => nameKey(p.name ?? '') === label);
  return undefined;
}
