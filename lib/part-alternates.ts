/**
 * Which other parts in this company's own inventory could be used instead of one part.
 *
 * Nothing here is invented: every suggestion comes from what the owner has already written down,
 * and each one carries the reason it was offered, so a wrong guess is obvious rather than quietly
 * trusted. Deliberately conservative — "charging pump 3D" must never be offered as a substitute
 * for "charging pump 3DX", because they are different machines.
 */

import { normalizeCode } from './part-search';

export type AlternatePart = {
  id: string;
  part_number: string;
  oem_number?: string | null;
  name: string;
  brand?: string | null;
  category?: string | null;
  compatibility?: string | null;
  current_stock?: number | string | null;
  sale_price?: number | string | null;
};

export type AlternateReason = 'same number' | 'same part, different entry' | 'fits the same machine' | 'similar name';

export type AlternateMatch<T extends AlternatePart> = {
  part: T;
  why: AlternateReason;
  /** One plain sentence saying what makes this a candidate. */
  detail: string;
};

// Words that say how a part was made or sold rather than what it is, so two entries that differ
// only by one of these are the same part twice: "Pinion seal" and "Pinion seal (orignal)".
const QUALIFIERS = new Set([
  'original', 'orignal', 'genuine', 'oe', 'oem', 'local', 'copy', 'duplicate', 'china', 'chinese',
  'imported', 'import', 'branded', 'company', 'spare', 'assy', 'assly', 'assembly', 'complete', 'extra',
]);
const STOP = new Set(['for', 'the', 'and', 'with', 'of', 'a', 'in']);

const words = (value: unknown) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

/** The part's name with the make-and-quality words taken out, which is what two entries of one
 *  part have in common. Model words (3D, 3DX, O/M) are kept: they are the part, not a label. */
export function coreName(name: string): string {
  return words(name).filter((word) => !QUALIFIERS.has(word) && !STOP.has(word)).join(' ');
}

const nameTokens = (name: string) => new Set(words(name).filter((word) => !STOP.has(word) && word.length > 1));

const overlapOf = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return (2 * shared) / (a.size + b.size);
};

const plain = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const rawCodes = (part: AlternatePart) => [part.part_number, part.oem_number].map((code) => String(code ?? '').trim()).filter(Boolean);
const amount = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const RANK: Record<AlternateReason, number> = {
  'same number': 0,
  'same part, different entry': 1,
  'fits the same machine': 2,
  'similar name': 3,
};

export function findAlternates<T extends AlternatePart>(part: T, catalogue: T[], limit = 8): AlternateMatch<T>[] {
  const myCodes = new Map(rawCodes(part).map((code) => [normalizeCode(code), code]));
  const myCore = coreName(part.name);
  const myTokens = nameTokens(part.name);
  const myCategory = plain(part.category);
  const myFits = plain(part.compatibility);

  const found: Array<AlternateMatch<T> & { score: number }> = [];
  for (const other of catalogue) {
    if (other.id === part.id) continue;
    const overlap = overlapOf(myTokens, nameTokens(other.name));
    const shared = rawCodes(other).find((code) => myCodes.has(normalizeCode(code)));

    let why: AlternateReason | null = null;
    let detail = '';
    if (shared) {
      why = 'same number';
      detail = `Carries the same number, ${shared}`;
    } else if (myCore && coreName(other.name) === myCore) {
      why = 'same part, different entry';
      detail = other.brand ? `The same name, ${other.brand}` : 'The same name, written differently';
    } else if (myCategory && myFits && plain(other.category) === myCategory && plain(other.compatibility) === myFits && overlap >= 0.5) {
      why = 'fits the same machine';
      detail = `Also ${other.category} for ${other.compatibility}`;
    } else if (overlap >= 0.7) {
      why = 'similar name';
      detail = 'Almost the same name';
    }
    if (!why) continue;

    found.push({ part: other, why, detail, score: overlap });
  }

  return found
    .sort((a, b) => RANK[a.why] - RANK[b.why] || b.score - a.score || amount(b.part.current_stock) - amount(a.part.current_stock))
    .slice(0, limit)
    .map(({ part: found_part, why, detail }) => ({ part: found_part, why, detail }));
}
