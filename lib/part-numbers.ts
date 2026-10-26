/**
 * A part's numbers, and its brands.
 *
 * The owner asked for two things in October 2026: a part can be known by several part numbers (a
 * supplier's code, a superseded JCB number, the maker's own), and the same part can be stocked in
 * more than one brand. They chose to keep each brand as its own item, with its own stock, cost and
 * price, so two items may share a part number when their brands differ.
 *
 * These are the rules every screen applies, kept in one pure place so they can be tested and so
 * the browser agrees with the database (scripts/part-numbers-and-brands.sql), which applies the
 * same tidying in jde_clean_other_numbers and the same "one number per brand" rule in its index.
 */

/** Punctuation, spaces and case carry no meaning in a code: "320/A7291", "320-a7291" and
 *  "320 A7291" are one number. The same rule as the database's tidying and the part search. */
export function partCode(value: unknown): string {
  return String(value ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

/** Most numbers any one part carries. Only stops a pasted list from flooding a row. */
export const MAX_OTHER_NUMBERS = 30;

/** A part's other numbers made tidy: trimmed, blanks dropped, one spelling per code (the first
 *  written), never the part's own number, at most 30. Matches jde_clean_other_numbers. */
export function cleanOtherNumbers(numbers: readonly unknown[] | null | undefined, mainNumber: unknown): string[] {
  const main = partCode(mainNumber);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of numbers ?? []) {
    const value = String(raw ?? '').trim().slice(0, 60);
    const code = partCode(value);
    if (!code || code === main || seen.has(code)) continue;
    seen.add(code);
    out.push(value);
    if (out.length >= MAX_OTHER_NUMBERS) break;
  }
  return out;
}

/** Numbers typed or pasted as one string: split on commas, semicolons and new lines. Never on "/"
 *  or spaces, which are part of real numbers here ("335/Y1458", "531-03208/09"). */
export function splitNumberList(text: string): string[] {
  return text.split(/[,;\n\r]+/).map((part) => part.trim()).filter(Boolean);
}

/** The minimum a part needs for these rules. */
export type NumberedPart = {
  id: string;
  name?: string | null;
  part_number?: string | null;
  other_numbers?: readonly string[] | null;
  oem_number?: string | null;
  brand?: string | null;
};

/** Every number a part is known by: its part number, its other numbers and any OEM number. */
export function numbersOf(part: Pick<NumberedPart, 'part_number' | 'other_numbers' | 'oem_number'>): string[] {
  return [part.part_number, ...(part.other_numbers ?? []), part.oem_number]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
}

/** The codes of every number a part is known by, for matching. */
export function codesOf(part: Pick<NumberedPart, 'part_number' | 'other_numbers' | 'oem_number'>): Set<string> {
  return new Set(numbersOf(part).map(partCode).filter(Boolean));
}

/** Whether a part answers to this number, as its part number or one of its other numbers. */
export function hasNumber(part: Pick<NumberedPart, 'part_number' | 'other_numbers' | 'oem_number'>, number: unknown): boolean {
  const code = partCode(number);
  return Boolean(code) && codesOf(part).has(code);
}

/** Brands compared the way the database compares them: case and outer spaces ignored, so "JCB",
 *  "jcb" and " Jcb " are one brand, and no brand at all is a brand of its own. */
export function brandKey(brand: unknown): string {
  return String(brand ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function sameBrand(a: unknown, b: unknown): boolean {
  return brandKey(a) === brandKey(b);
}

/** How a brand reads in a sentence, including the part that has none. */
export function brandLabel(brand: unknown): string {
  const value = String(brand ?? '').trim();
  return value || 'no brand';
}

/**
 * Other parts already using this part number, split by whether they are the same brand.
 *
 * The same brand is a real clash (the database refuses it: one number per brand). A different brand
 * is fine, and is how the same part from another maker is kept; the form says so instead of warning.
 */
export function partNumberUsers<T extends NumberedPart>(
  partNumber: string,
  brand: string,
  parts: readonly T[],
  excludeId?: string,
): { sameBrand: T[]; otherBrands: T[] } {
  const code = partCode(partNumber);
  const result = { sameBrand: [] as T[], otherBrands: [] as T[] };
  if (!code) return result;
  for (const part of parts) {
    if (part.id === excludeId || partCode(part.part_number) !== code) continue;
    (sameBrand(part.brand, brand) ? result.sameBrand : result.otherBrands).push(part);
  }
  return result;
}

/** Other parts that answer to one of these numbers, for the form's "also on" note. */
export function partsAnsweringTo<T extends NumberedPart>(numbers: readonly string[], parts: readonly T[], excludeId?: string): Array<{ number: string; part: T }> {
  const out: Array<{ number: string; part: T }> = [];
  for (const number of numbers) {
    const code = partCode(number);
    if (!code) continue;
    for (const part of parts) {
      if (part.id !== excludeId && codesOf(part).has(code)) out.push({ number, part });
    }
  }
  return out;
}

/**
 * The same part in other brands: other items sharing one of this part's numbers but with a
 * different brand. This is what "Add another brand" makes, since the copy keeps the numbers.
 * Ordered by brand so the list reads the same every time.
 */
export function otherBrandsOf<T extends NumberedPart>(part: NumberedPart, parts: readonly T[]): T[] {
  const mine = codesOf(part);
  if (mine.size === 0) return [];
  return parts
    .filter((other) => other.id !== part.id && !sameBrand(other.brand, part.brand) && [...codesOf(other)].some((code) => mine.has(code)))
    .sort((a, b) => brandLabel(a.brand).localeCompare(brandLabel(b.brand)));
}
