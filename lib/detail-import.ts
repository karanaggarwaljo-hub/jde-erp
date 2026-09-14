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
 *
 *  One kind of file is trusted further: the parts worksheet this app exports. Its "Old label"
 *  column carries the code each part holds in the ERP right now, and since part numbers were made
 *  unique per company that code names exactly one part. A row matched that way is the owner
 *  saying, in their own sheet, "this row IS this part". So what they wrote is what the part
 *  becomes: the name can be corrected, and a brand, category, compatibility or part number that
 *  disagrees is offered as a replacement instead of being left alone. Every one is still shown old
 *  and new, and can be unticked. Any other file, matched any other way, gets exactly the caution it
 *  always had — a supplier's invoice must never rename a part because it words it differently.
 */

/** The name is only ever planned for a row matched by the part's current code — see the header. */
export type DetailField = 'name' | 'part_number' | 'oem_number' | 'hsn_code' | 'brand' | 'category' | 'compatibility';

/** Every field this will touch, in the order it is shown. Deliberately excludes anything
 *  numeric: prices and stock are other jobs, with their own preview and their own confirmation. */
export const DETAIL_FIELDS: { field: DetailField; label: string }[] = [
  { field: 'name', label: 'Name' },
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
  | 'keep'
  /** Would give this part a part number another part already has, or will have once this file is
   *  applied. Shown, never written: the database refuses it with a unique index, and in a bulk save
   *  that refusal arrives partway through, after other parts have already changed. */
  | 'clash';

export type DetailChange = {
  field: DetailField;
  label: string;
  from: string;
  to: string;
  kind: DetailChangeKind;
  /** Why a change is not offered, in words. Set on a clash. */
  note?: string;
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
  matchedBy?: 'current code' | 'part number' | 'OEM number' | 'name';
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
function planField(field: DetailField, label: string, existingRaw: string, incomingRaw: string, certain = false): DetailChange | null {
  const existing = text(existingRaw);
  const incoming = text(incomingRaw);
  // A blank cell never erases anything, however the row was matched.
  if (!incoming) return null;

  // The owner's own worksheet, matched by the part's current code: what they typed is the answer.
  // Compared exactly as written, because a correction that only fixes capitals or punctuation —
  // "big pinion beraing" to "Big Pinion Bearing", "331-34392" to "331/34392" — is still one.
  if (certain) {
    if (existing === incoming) return null;
    return { field, label, from: existing, to: incoming, kind: existing ? 'replace' : 'fill' };
  }

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
    // First: the code the ERP gave this part, carried in the worksheet's Old label column. Part
    // numbers are unique per company, so it names exactly one part.
    { label: 'current code', value: (r) => codeKey(r.current_code ?? ''), index: byPart },
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
      // Certain when matched by the current code, or when the row comes from the owner's own
      // worksheet and matched by part number. The worksheet leaves Old label blank for a part that
      // already carries a real number, and pre-fills Part No with that same number, so for those
      // parts the number is the identity. A supplier document has no Old label column at all, so
      // none of its rows qualify however well their part numbers match.
      const fromWorksheet = row.current_code !== undefined;
      const certain = attempt.label === 'current code' || (fromWorksheet && attempt.label === 'part number');
      const changes = DETAIL_FIELDS
        // Renaming is only for a row that is certainly this part. A supplier invoice matched by part
        // number describes the part in its own words, and those are not the owner's name for it.
        .filter(({ field }) => field !== 'name' || certain)
        .map(({ field, label }) => planField(field, label, text((product as Record<string, unknown>)[field] as string), text((row as Record<string, unknown>)[field] as string), certain))
        .filter((change): change is DetailChange => change !== null);

      const worthWriting = changes.some(isOfferedDetail);
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

  // A corrected part number must not land on a number another part holds now, or will hold once
  // this file is applied. Both count: swapping two parts' numbers ends in a clean state, but saved
  // one part at a time the first save collides with the second part's current number. Compared
  // with punctuation ignored, as a scan compares them — "SP-258" and "sp258" are one number.
  const productById = new Map(products.map((p) => [p.id, p]));
  const offeredNumber = (match: DetailMatch) =>
    match.outcome === 'update' ? match.changes.find((c) => c.field === 'part_number' && isOfferedDetail(c)) : undefined;

  const holders = new Map<string, Set<string>>();
  const hold = (key: string, id: string) => {
    if (!key) return;
    const set = holders.get(key);
    if (set) set.add(id);
    else holders.set(key, new Set([id]));
  };
  for (const p of products) hold(codeKey(p.part_number), p.id);
  for (const match of matches) {
    const change = offeredNumber(match);
    if (change && match.product) hold(codeKey(change.to), match.product.id);
  }

  for (const match of matches) {
    const change = offeredNumber(match);
    if (!change || !match.product) continue;
    const self = match.product.id;
    const others = Array.from(holders.get(codeKey(change.to)) ?? []).filter((id) => id !== self);
    if (others.length === 0) continue;
    change.kind = 'clash';
    change.note = 'already on ' + others.map((id) => productById.get(id)?.name ?? id).join(', ');
    if (!match.changes.some(isOfferedDetail)) {
      match.outcome = 'nothing_to_add';
      match.reason = 'the only change would give it a part number another part already has';
    }
  }

  return matches;
}

/** True for a change the owner can tick — a fill or a replacement. A keep and a clash are shown as
 *  warnings and are never written. */
export function isOfferedDetail(change: DetailChange): boolean {
  return change.kind === 'fill' || change.kind === 'replace';
}

/** The fields of one match that would actually be written, given what the owner has left ticked.
 *  Only a fill or a replacement is ever included; a keep or a clash is a warning, not an offer. */
export function fieldsToWrite(match: DetailMatch, accepted: (change: DetailChange) => boolean): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const change of match.changes) {
    if (!isOfferedDetail(change)) continue;
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
