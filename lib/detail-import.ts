import type { ImportedProduct } from './client-import';

/** Works out which existing part each row of a supplier document refers to, and which of that
 *  part's identifying details it could fill in or correct — the part number, OEM number, HSN
 *  code, brand, category and compatibility.
 *
 *  This exists because the inventory was built up with invented part numbers: of 944 parts, 447
 *  have none at all and 406 carry a code like AIR-F90 or STI-B168, generated from the first
 *  letters of the name. Those codes mean nothing outside this shop — a customer or supplier given
 *  one cannot act on it. The real numbers exist only on the parts themselves and on supplier
 *  paperwork, so this reads them off that paperwork in bulk.
 *
 *  Pure and side-effect free, like planCostUpdates next to it: it decides what a bulk edit of
 *  identifying fields WOULD do, so it can be shown in full and tested on its own before anything
 *  is written. Nothing here touches the database, stock, or money — this changes what a part is
 *  called, never how many there are or what they cost.
 */

export type DetailField = 'part_number' | 'oem_number' | 'hsn_code' | 'brand' | 'category' | 'compatibility';

/** Every field this will touch, in the order it is shown. Deliberately excludes anything
 *  numeric: prices and stock are other jobs, with their own preview and their own confirmation. */
export const DETAIL_FIELDS: { field: DetailField; label: string }[] = [
  { field: 'part_number', label: 'Part no' },
  { field: 'oem_number', label: 'OEM no' },
  { field: 'hsn_code', label: 'HSN' },
  { field: 'brand', label: 'Brand' },
  { field: 'category', label: 'Category' },
  { field: 'compatibility', label: 'Fits' },
];

export type DetailMatchProduct = {
  id: string;
  part_number: string;
  oem_number: string;
  hsn_code?: string;
  name: string;
  brand?: string;
  category?: string;
  compatibility?: string;
};

export type DetailChangeKind =
  /** The part has nothing here and the document does — safe, and ticked by default. */
  | 'fill'
  /** The part carries one of this shop's own invented codes and the document has a real one.
   *  Ticked by default, because replacing those is the entire point — but always shown as
   *  old → new so it is a decision, not a surprise. */
  | 'replace'
  /** Both have a value and they disagree, but the existing one does NOT look invented. Never
   *  applied automatically: it may well be right, and the document may be the wrong part. */
  | 'keep';

export type DetailChange = {
  field: DetailField;
  label: string;
  from: string;
  to: string;
  kind: DetailChangeKind;
};

export type DetailOutcome =
  /** Matched one part, and there is something to write. */
  | 'update'
  /** Matched one part, but the document adds nothing it doesn't already have. */
  | 'nothing_to_add'
  /** No part in this company matches this row. Left alone; never created here. */
  | 'not_found'
  /** Matched more than one part, or two rows point at the same part. Never guessed at. */
  | 'conflict';

export type DetailMatch = {
  rowNumber: number;
  name: string;
  outcome: DetailOutcome;
  product?: DetailMatchProduct;
  matchedBy?: 'part number' | 'OEM number' | 'name';
  changes: DetailChange[];
  reason?: string;
};

/** Part numbers are written inconsistently by hand and by suppliers — "JCB-H49", "jcb h49" and
 *  "JCBH49" are one part. Punctuation and case carry no meaning in a code, so drop both. */
const codeKey = (value: string): string => (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Names are prose, so only case and spacing are safe to normalise. Stripping punctuation here
 *  would merge genuinely different parts. */
const nameKey = (value: string): string => (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Does this code look like one this shop invented rather than a manufacturer's?
 *
 * Judged from the real inventory: `SP-053`, and 406 codes of the shape `AIR-F90`, `STI-B168`,
 * `BRA-R138` — two to four letters taken from the part name, a dash, an optional letter, a short
 * number. Fifty more are the same thing typed with a stray space (`HP -G39`, `SLE- 98`).
 *
 * Real manufacturer numbers do not look like this: `331/34392`, `335/Y7275`, `P00-12400` and
 * `32/925994` are all left alone by every rule below.
 *
 * A false positive here costs nothing — it only means a replacement is OFFERED, shown as
 * old → new, for the owner to accept or reject.
 */
export function looksLikeAnInventedCode(code: string): boolean {
  const raw = text(code);
  if (!raw) return false;

  // A code with a space in the middle was typed, not printed — no supplier prints "HP -G39".
  if (/\s/.test(raw)) return true;

  const compact = raw.toUpperCase();
  if (/^SP-?\d{1,6}$/.test(compact)) return true;
  // Letters-from-the-name, dash, optional letter, short number. The letter-only prefix is what
  // separates these from real codes like P00-12400, which starts with digits inside its prefix.
  if (/^[A-Z]{2,4}-[A-Z]?\d{1,4}$/.test(compact)) return true;
  return false;
}

function indexBy(products: DetailMatchProduct[], pick: (p: DetailMatchProduct) => string, key: (v: string) => string) {
  const map = new Map<string, DetailMatchProduct[]>();
  for (const product of products) {
    const value = key(pick(product) ?? '');
    if (!value) continue;
    const bucket = map.get(value);
    if (bucket) bucket.push(product);
    else map.set(value, [product]);
  }
  return map;
}

/** What one field of one part would become. Returns null when there is nothing to say. */
function planField(field: DetailField, label: string, existingRaw: string, incomingRaw: string): DetailChange | null {
  const existing = text(existingRaw);
  const incoming = text(incomingRaw);
  if (!incoming) return null;
  if (codeKey(existing) === codeKey(incoming) && existing) return null; // already the same

  if (!existing) return { field, label, from: '', to: incoming, kind: 'fill' };
  // Only part numbers are ever auto-generated by this app; a brand or category that disagrees is
  // a judgement call, never an obvious replacement.
  if (field === 'part_number' && looksLikeAnInventedCode(existing)) {
    return { field, label, from: existing, to: incoming, kind: 'replace' };
  }
  return { field, label, from: existing, to: incoming, kind: 'keep' };
}

/**
 * Matches every row of the document against the parts already on file and lists what it could
 * add. Match order is part number, then OEM, then name — but with most parts carrying invented
 * codes or none at all, the name is what actually does the work here, which is why an ambiguous
 * name is reported as a conflict rather than resolved by picking one.
 */
export function planDetailUpdates(rows: ImportedProduct[], products: DetailMatchProduct[]): DetailMatch[] {
  const byPart = indexBy(products, (p) => p.part_number, codeKey);
  const byOem = indexBy(products, (p) => p.oem_number, codeKey);
  const byName = indexBy(products, (p) => p.name, nameKey);

  const attempts: Array<{ label: DetailMatch['matchedBy']; value: (r: ImportedProduct) => string; index: Map<string, DetailMatchProduct[]> }> = [
    { label: 'part number', value: (r) => codeKey(r.part_number), index: byPart },
    { label: 'OEM number', value: (r) => codeKey(r.oem_number), index: byOem },
    { label: 'name', value: (r) => nameKey(r.name), index: byName },
  ];

  const matches: DetailMatch[] = rows.map((row, index) => {
    const rowNumber = index + 1;
    const name = text(row.name);

    for (const attempt of attempts) {
      const key = attempt.value(row);
      if (!key) continue;
      const found = attempt.index.get(key);
      if (!found || found.length === 0) continue;
      if (found.length > 1) {
        return {
          rowNumber,
          name,
          outcome: 'conflict',
          matchedBy: attempt.label,
          changes: [],
          reason: `matches ${found.length} different parts by ${attempt.label} — left alone`,
        };
      }

      const product = found[0];
      const changes = DETAIL_FIELDS
        .map(({ field, label }) => planField(field, label, text((product as Record<string, unknown>)[field] as string), text((row as Record<string, unknown>)[field] as string)))
        .filter((change): change is DetailChange => change !== null);

      const worthWriting = changes.some((change) => change.kind !== 'keep');
      return {
        rowNumber,
        name,
        outcome: worthWriting ? 'update' : 'nothing_to_add',
        product,
        matchedBy: attempt.label,
        changes,
        ...(worthWriting ? {} : { reason: changes.length ? 'nothing new that is safe to apply' : 'already has these details' }),
      };
    }

    return { rowNumber, name, outcome: 'not_found', changes: [], reason: 'no part in this company matches' };
  });

  // Two rows pointing at one part is a mistake in the document, not something to resolve by
  // letting whichever came last win silently.
  const byProduct = new Map<string, DetailMatch[]>();
  for (const match of matches) {
    if (!match.product) continue;
    const bucket = byProduct.get(match.product.id);
    if (bucket) bucket.push(match);
    else byProduct.set(match.product.id, [match]);
  }
  for (const group of byProduct.values()) {
    if (group.length < 2) continue;
    const rowNumbers = group.map((m) => m.rowNumber).join(', ');
    for (const match of group) {
      match.outcome = 'conflict';
      match.changes = [];
      match.reason = `rows ${rowNumbers} all point at this part — left alone`;
    }
  }

  return matches;
}

/** The fields of one match that would actually be written, given what the owner has left ticked.
 *  'keep' changes are never included: they are shown as a warning, not offered. */
export function fieldsToWrite(match: DetailMatch, accepted: (change: DetailChange) => boolean): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const change of match.changes) {
    if (change.kind === 'keep') continue;
    if (!accepted(change)) continue;
    patch[change.field] = change.to;
  }
  return patch;
}

export type DetailPlanCounts = Record<DetailOutcome, number>;

export function countDetailOutcomes(matches: DetailMatch[]): DetailPlanCounts {
  const counts: DetailPlanCounts = { update: 0, nothing_to_add: 0, not_found: 0, conflict: 0 };
  for (const match of matches) counts[match.outcome] += 1;
  return counts;
}
