/**
 * Finding a part by what the customer calls it (November 2026, at the owner's request).
 *
 * A customer asks for a "grari", a "kamani" or a "race wire"; the shelf list says gear, spring,
 * accelerator cable. Or the list itself is spelled the way it was typed in a hurry ("stearing",
 * "plantery", "bering"). Three things close that gap, all used by every part search:
 *
 *   1. Other names kept on the part itself (jde_products.other_names): whatever this shop's
 *      customers call it. Typed in Stock, or saved with one click from a bill the first time a
 *      part is found under a new word (components/PartPicker.tsx).
 *   2. Shop words: a fixed list of everyday Hindi/Punjabi and trade words for parts, and the
 *      spellings this catalogue really uses, each group meaning one thing (SHOP_WORDS).
 *   3. Spelling slips: a typed word of five letters or more also matches a word one letter off
 *      (two for long words), so "bering" finds BEARING and "stearing" finds STEERING. Numbers are
 *      never stretched this way: 6007 and 6008 are different bearings.
 *
 * Pure, so the matching can be tested on its own.
 */

/** Words that mean the same thing at a parts counter. Each group is one thing; the first word is
 *  the plain English one shown when a match came through the group. Phrases are allowed. */
export const SHOP_WORDS: readonly (readonly string[])[] = [
  ['gear', 'grari', 'garari', 'gari'],
  ['bearing', 'bering', 'beraing', 'bairing'],
  ['steering', 'stearing', 'stering'],
  ['planetary', 'plantery', 'planetry', 'plantry', 'plantary', 'pamtary'],
  ['silencer', 'silancer', 'muffler'],
  ['alternator', 'altinator', 'dynamo'],
  ['indicator', 'indigator', 'blinker'],
  ['gasket', 'gaskit', 'packing'],
  ['grease', 'greas'],
  ['hydraulic', 'hydarulic', 'hydrolic', 'hydralic'],
  ['strainer', 'stanner', 'stainer'],
  ['accelerator', 'exilator', 'race', 'rase'],
  ['chisel', 'chizzle', 'chheni'],
  ['lever', 'liver', 'leaver', 'dandi'],
  ['loader', 'loder'],
  ['bucket', 'bkt'],
  ['stabilizer', 'stabiliser', 'stablizer', 'stab', 'stb'],
  ['pad', 'tikki', 'tiki'],
  ['bush', 'bushing'],
  ['pipe', 'hose', 'nali'],
  ['original', 'orignal', 'genuine'],
  ['nozzle', 'nojal', 'nozal'],
  ['cylinder', 'jack', 'ram'],
  ['tooth', 'teeth', 'daant', 'dant'],
  ['spring', 'kamani'],
  ['washer', 'vashal', 'vasal', 'washar'],
  ['clutch', 'clach'],
  ['radiator', 'redieter', 'radietor'],
  ['starter', 'self'],
  ['mirror', 'sheesha', 'shisha'],
  ['wire', 'taar', 'cable'],
  ['belt', 'patta'],
  ['fan', 'pankha'],
  ['plate', 'patti', 'pati'],
  ['coupling', 'kapling', 'coupler'],
  ['cross', 'spider'],
  ['tank', 'tanki'],
  ['cap', 'dhakkan', 'dhakan', 'dhakkn'],
  ['light', 'lamp', 'batti'],
  ['key', 'chabi', 'chaabi'],
  ['handle', 'hattha', 'hatha'],
  ['ring', 'chhalla', 'challa'],
  ['diesel', 'disel', 'deasel', 'diesal'],
  ['brake', 'break'],
  ['hub', 'hos', 'hus'],
  ['king pin carrier', 'kpc'],
  ['new model', 'nm'],
  ['old model', 'om'],
];

/** One word as it is compared: lower case, letters and digits only, a plural "s" dropped. */
function wordKey(raw: string): string {
  const word = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

/** The words of a piece of text, as compared. "N/M" is one word ("nm"), as the shop writes it;
 *  a full stop separates words ("GASKET.CYLINDER HEAD"). */
export function wordsOf(text: string): string[] {
  return text.split(/[\s,.()&+]+/).map(wordKey).filter(Boolean);
}

const GROUP_OF = new Map<string, readonly string[]>();
for (const group of SHOP_WORDS) {
  for (const member of group) {
    const key = wordsOf(member).join(' ');
    if (key && !GROUP_OF.has(key)) GROUP_OF.set(key, group);
  }
}

/** Optimal-string-alignment distance: insertions, deletions, substitutions and swapping two
 *  neighbouring letters each cost one. Stops early once it is past `limit`. */
function distance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i += 1) rows.push([i]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, rows[i - 2][j - 2] + 1);
      rows[i][j] = value;
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
  }
  return rows[a.length][b.length];
}

/** How many letters a typed word may be off and still count: none under five letters (seal and
 *  seat, gear and bear are different things), one up to six, two from seven. Words with digits in
 *  them must be exact. */
function slack(word: string): number {
  if (/[0-9]/.test(word) || word.length < 5) return 0;
  return word.length >= 7 ? 2 : 1;
}

/** The typed word is a slip of this word, or of how it starts (it may still be being typed). */
function spelledLike(typed: string, word: string): boolean {
  const allowed = slack(typed);
  if (!allowed || /[0-9]/.test(word)) return false;
  if (distance(typed, word, allowed) <= allowed) return true;
  for (let length = typed.length - 1; length <= typed.length + 1; length += 1) {
    if (length >= 5 && length < word.length && distance(typed, word.slice(0, length), allowed) <= allowed) return true;
  }
  return false;
}

/** A found word and, when it was not typed as it is written, how it was reached (for the list). */
type WordHit = { exact: boolean; how?: string };

function findWord(typed: string, words: readonly string[], text: string): WordHit | null {
  if (words.some((word) => word.startsWith(typed))) return { exact: true };
  const group = GROUP_OF.get(typed);
  if (group) {
    for (const member of group) {
      const key = wordsOf(member).join(' ');
      if (key === typed) continue;
      const found = key.includes(' ') ? ` ${text} `.includes(` ${key} `) : words.includes(key);
      if (found) return { exact: false, how: `${typed} = ${key}` };
    }
  }
  const close = words.find((word) => spelledLike(typed, word));
  if (close) return { exact: false, how: `${typed} ≈ ${close}` };
  return null;
}

/** The query again with a shop phrase written as its short word ("king pin carrier" → "kpc"), so
 *  the long and short ways of saying it find each other in both directions. */
function queryForms(words: string[]): Array<{ words: string[]; how: string }> {
  const forms = [{ words, how: '' }];
  const joined = ` ${words.join(' ')} `;
  for (const group of SHOP_WORDS) {
    for (const member of group) {
      const key = wordsOf(member).join(' ');
      if (!key.includes(' ') || !joined.includes(` ${key} `)) continue;
      for (const other of group) {
        const otherKey = wordsOf(other).join(' ');
        if (otherKey !== key) forms.push({ words: joined.replace(` ${key} `, ` ${otherKey} `).trim().split(' '), how: `${key} = ${otherKey}` });
      }
    }
  }
  return forms;
}

export type LooseMatch = { exactWords: number; how: string };

/**
 * Whether every typed word is found in these texts by meaning or by a near spelling, when plain
 * matching found nothing. Null when some word is not found at all. `how` says how the first
 * word that needed help was reached ("grari = gear", "bering ≈ bearing").
 */
export function looseMatch(query: string, texts: readonly (string | null | undefined)[]): LooseMatch | null {
  const typed = wordsOf(query);
  if (typed.length === 0) return null;
  const words = texts.flatMap((text) => wordsOf(String(text ?? '')));
  const text = words.join(' ');
  let best: LooseMatch | null = null;
  for (const form of queryForms(typed)) {
    let exactWords = 0;
    let how = form.how;
    let all = true;
    for (const word of form.words) {
      const hit = findWord(word, words, text);
      if (!hit) { all = false; break; }
      if (hit.exact) exactWords += 1;
      else if (!how) how = hit.how ?? '';
    }
    if (all && (!best || exactWords > best.exactWords)) best = { exactWords, how };
  }
  return best && best.how ? best : null;
}

/** Other names as they are kept: tidied, no repeats (capitals aside), not the part's own name,
 *  at most 20 of 40 characters each. */
export function cleanOtherNames(names: readonly unknown[] | null | undefined, mainName: unknown): string[] {
  const main = String(mainName ?? '').trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names ?? []) {
    const value = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const key = value.toLowerCase();
    if (!value || key === main || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= 20) break;
  }
  return out;
}

/** "grari, gear wheel; kamani" → three names. */
export function splitNameList(text: string): string[] {
  return text.split(/[,;\n\r]+/).map((part) => part.trim()).filter(Boolean);
}

/** Whether what was typed is already one of the part's names (its name or another name), so
 *  there is nothing new to remember. */
export function alreadyNamed(query: string, name: string, otherNames: readonly string[] = []): boolean {
  const typed = wordsOf(query).join(' ');
  if (!typed) return true;
  return [name, ...otherNames].some((existing) => ` ${wordsOf(existing).join(' ')} `.includes(` ${typed} `));
}
