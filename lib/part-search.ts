/**
 * Finding a part, the way someone standing at a counter actually looks for one.
 *
 * Used when billing a sale and when keying a supplier's invoice — the same catalogue, looked up
 * the same way. Both forms previously used a native <datalist>, which only ever matched the full
 * concatenated label ("SP-258 - STEARING COUPLING 3DX") character for character. Typing the part
 * number alone matched nothing, a barcode scanner's output matched nothing, and a hyphen in the
 * wrong place matched nothing — with 252 parts in the real catalogue and 944 across all
 * companies, that is the difference between keying a document in a minute and hunting through
 * a list.
 *
 * Three things this has to get right:
 *
 *   1. A part number typed or scanned in any punctuation wins outright. "p0012400", "P00-12400"
 *      and "P00 12400" are the same part, because that is how they are written on a box, on an
 *      invoice from the supplier, and by whoever is typing.
 *   2. Several loose words match in any order — "bearing pinion" finds "BIG PINION BEARING".
 *      Nobody remembers a catalogue name in its exact word order.
 *   3. Out of stock never means hidden. A trader sells what they have to order in, and buying is
 *      precisely how a part with none on the shelf gets restocked.
 *
 * Pure and synchronous — no fetching, no React — so the ranking can be tested on its own.
 */

/** The minimum a part has to expose to be findable. Both the sales catalogue and the purchases
 *  one satisfy this structurally, so neither screen's row type is imported here — this module
 *  ranks parts and knows nothing about what either screen does with the one that is picked. */
export type SearchablePart = {
  value: string;
  partNumber: string;
  /** Every other number the part is known by (lib/part-numbers.ts). Typed or scanned, any of them
   *  finds the part exactly as its part number does. */
  otherNumbers?: readonly string[];
  name: string;
  brand: string;
  stock: number;
};

/** Strips punctuation and case so a code matches however it happens to be written down.
 *  "P00-12400", "p00 12400" and "P0012400" all normalize to the same thing. */
export function normalizeCode(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function normalizeText(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

export type MatchReason =
  | 'exact-code'
  | 'code-prefix'
  | 'name-prefix'
  | 'code-contains'
  | 'name-contains'
  | 'brand'
  | 'all-words';

export type PartMatch<T extends SearchablePart = SearchablePart> = {
  part: T;
  score: number;
  why: MatchReason;
  /** The other number that matched, when it was not the part number, so the list can show it. */
  via?: string;
};

// Ordered so that a stronger reason always outranks a weaker one no matter how many weak
// reasons a part collects. Nothing sums — each part is scored by its single best reason.
const SCORES: Record<MatchReason, number> = {
  'exact-code': 1000,
  'code-prefix': 500,
  'name-prefix': 320,
  'code-contains': 240,
  'name-contains': 180,
  'brand': 120,
  'all-words': 80,
};

/** How a typed code meets one of the part's numbers, strongest first, and which number it was. */
function codeReason(part: SearchablePart, code: string): { why: MatchReason; via?: string } | null {
  if (!code) return null;
  const numbers = [part.partNumber, ...(part.otherNumbers ?? [])];
  const checks: Array<[MatchReason, (candidate: string) => boolean]> = [
    ['exact-code', (candidate) => candidate === code],
    ['code-prefix', (candidate) => candidate.startsWith(code)],
    ['code-contains', (candidate) => candidate.includes(code)],
  ];
  for (const [why, test] of checks) {
    const hit = numbers.find((number) => test(normalizeCode(number)));
    if (hit !== undefined) return { why, via: hit === part.partNumber ? undefined : hit };
  }
  return null;
}

function bestReason(part: SearchablePart, rawQuery: string): { why: MatchReason; via?: string } | null {
  const code = normalizeCode(rawQuery);
  const byCode = codeReason(part, code);
  if (byCode && byCode.why !== 'code-contains') return byCode;

  const query = normalizeText(rawQuery);
  const name = normalizeText(part.name);
  const brand = normalizeText(part.brand);
  if (name.startsWith(query)) return { why: 'name-prefix' };
  if (byCode) return byCode;
  if (name.includes(query)) return { why: 'name-contains' };
  if (brand.length > 0 && brand.includes(query)) return { why: 'brand' };

  // Last resort: every word typed appears somewhere, in any order. This is what makes
  // "bearing pinion" find "BIG PINION BEARING 803149/10".
  const words = query.split(' ').filter(Boolean);
  if (words.length > 1) {
    const haystack = `${normalizeText(part.partNumber)} ${(part.otherNumbers ?? []).map(normalizeText).join(' ')} ${name} ${brand}`;
    if (words.every((word) => haystack.includes(word))) return { why: 'all-words' };
  }
  return null;
}

/**
 * The ranked shortlist for what has been typed so far. Empty query gives an empty list — the
 * picker shows nothing until there is something to go on, rather than dumping 944 rows.
 */
export function searchParts<T extends SearchablePart>(rawQuery: string, parts: T[], limit = 8): PartMatch<T>[] {
  const query = rawQuery.trim();
  if (!query) return [];

  const matches: PartMatch<T>[] = [];
  for (const part of parts) {
    const reason = bestReason(part, query);
    if (reason) matches.push({ part, score: SCORES[reason.why], why: reason.why, ...(reason.via ? { via: reason.via } : {}) });
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Something on the shelf is the likelier sale, so it goes first — but nothing is dropped
    // for being out of stock, because ordering a part in is a normal sale here.
    const aStocked = a.part.stock > 0 ? 1 : 0;
    const bStocked = b.part.stock > 0 ? 1 : 0;
    if (aStocked !== bStocked) return bStocked - aStocked;
    return a.part.name.localeCompare(b.part.name);
  });

  return matches.slice(0, limit);
}

/** Every part whose number is exactly what was typed or scanned, punctuation aside. Usually none
 *  or one; more than one is the SP-258 case, which is real — three different products in the live
 *  catalogue carry that same number. */
export function exactCodeMatches<T extends SearchablePart>(rawQuery: string, parts: T[]): T[] {
  const code = normalizeCode(rawQuery);
  if (!code) return [];
  return parts.filter((part) => [part.partNumber, ...(part.otherNumbers ?? [])].some((number) => normalizeCode(number) === code));
}

/**
 * The part a barcode scan or a fully typed part number unambiguously means, or null.
 *
 * Scanners type the code and press Enter faster than any dropdown can settle, so Enter has to be
 * able to resolve the code on its own. Deliberately null when two parts share a code rather than
 * picking one: silently billing whichever sorted first is exactly the kind of wrong that reaches
 * a customer.
 */
export function scannedPart<T extends SearchablePart>(rawQuery: string, parts: T[]): T | null {
  const exact = exactCodeMatches(rawQuery, parts);
  return exact.length === 1 ? exact[0] : null;
}

/** True when what was typed is a part number that several parts share, so a keystroke must not
 *  resolve it. The picker leaves the list open and waits for a real choice instead. */
export function isAmbiguousCode(rawQuery: string, parts: SearchablePart[]): boolean {
  return exactCodeMatches(rawQuery, parts).length > 1;
}
