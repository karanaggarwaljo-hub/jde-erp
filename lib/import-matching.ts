/**
 * Deciding which inventory part an imported invoice line refers to, and what that line can teach
 * an existing part.
 *
 * Kept out of the Purchases page on purpose: this is the logic with real money behind it — the
 * difference between restocking the part you already own and silently creating a duplicate — and
 * it is pure, so it can be exercised directly by scripts/import-matching-check.ts.
 */
import type { ImportedLine } from './client-import';
import { brandKey, codesOf, partCode } from './part-numbers';

/** Only the product fields matching cares about, so a caller can pass its own richer row. */
export type MatchableProduct = {
  id: string;
  part_number: string;
  /** Its other numbers (lib/part-numbers.ts): a bill printing any of them identifies the part. */
  other_numbers?: readonly string[] | null;
  oem_number: string;
  hsn_code: string;
  brand: string;
  name: string;
  cost_price: number;
  current_stock: number;
};

export function normalizeImportText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/**
 * Only use exact, explainable matches for imports. A fuzzy match that silently attaches a
 * supplier's "Seal kit" to the wrong inventory part is much more costly than showing the owner
 * one extra review warning. The selected datalist format ("PART-1 - Part name") is supported too.
 */
function matchImportedProducts(description: string, products: MatchableProduct[]): MatchableProduct[] {
  const trimmed = description.trim();
  const normalized = normalizeImportText(trimmed);
  if (!normalized) return [];

  return products.filter((product) => {
    const partNumber = product.part_number.trim();
    const partNumberPrefix = partNumber
      ? new RegExp(`^${partNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s*[-:|]\\s*|\\s*$)`, 'i')
      : null;
    return normalized === normalizeImportText(product.name)
      || normalized === normalizeImportText(`${partNumber} - ${product.name}`)
      // The picker's label for one part kept in two brands carries the brand (lib/trade-history.ts).
      || (Boolean(product.brand?.trim()) && normalized === normalizeImportText(`${partNumber} - ${product.name} (${product.brand})`))
      || normalized === normalizeImportText(partNumber)
      || Boolean(partNumberPrefix?.test(trimmed));
  });
}

function normalizeCode(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** "SP-014" and friends are placeholders this app invented during an earlier import because the
 *  source document carried no real code — not something a supplier ever printed. An invoice that
 *  does carry a real part number is therefore allowed to replace one, where it would never be
 *  allowed to overwrite a number the owner actually entered.
 *
 *  Deliberately NARROWER than looksLikeAnInventedCode in lib/detail-import.ts, which also treats
 *  shapes like "AIR-F90" as invented. Do not merge them: the two carry different risks. There, a
 *  false positive only OFFERS a replacement the owner can decline. Here it decides whether a code
 *  may be trusted as an exact match, so a false positive would refuse a genuine supplier code
 *  like "ABC-123", drop the row to name matching, and can end up creating a duplicate part. */
function isPlaceholderPartNumber(value: string): boolean {
  return /^sp-?\d+$/i.test(value.trim());
}

function nameTokens(value: string): Set<string> {
  return new Set(normalizeImportText(value).split(' ').filter((token) => token.length > 2));
}

/** Dice coefficient over the words of two names: 1 means identical wording, 0 nothing in common. */
function nameSimilarity(a: string, b: string): number {
  const left = nameTokens(a);
  const right = nameTokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

const SUGGESTION_THRESHOLD = 0.55;

/**
 * What this line appears to be, and how sure we are.
 *
 * 'exact' is only ever an identifier or a full text match — something explainable in one phrase,
 * safe to act on unattended. Anything reached by word similarity is 'suggested' and waits for the
 * owner to confirm: silently attaching a supplier's "Seal kit" to the wrong inventory part puts
 * stock and cost in the wrong place, which is far more expensive to unpick than one extra click.
 */
export type LineMatch =
  | { kind: 'exact'; product: MatchableProduct; reason: string }
  /** `others`: the rest of the parts it could be, when one number is kept in several brands, so
   *  the owner picks the brand rather than only saying yes or no to the first. */
  | { kind: 'suggested'; product: MatchableProduct; reason: string; others?: MatchableProduct[] }
  | { kind: 'none' };

/** Brands as printed on bills vary ("JCB", "JCB India Ltd"), so two agree when they are the same,
 *  when one contains the other, or when either is missing. */
export function brandsAgree(a: unknown, b: unknown): boolean {
  const x = brandKey(a);
  const y = brandKey(b);
  return !x || !y || x === y || x.includes(y) || y.includes(x);
}

/** Which of a part's numbers a line names, or null. Suppliers routinely print an OEM number in their
 *  own "part no" column, so the line's part number is compared against every number and vice versa. */
function identifierReason(product: MatchableProduct, line: ImportedLine): string | null {
  const linePart = normalizeCode(line.part_number);
  const lineOem = normalizeCode(line.oem_number);
  const productPart = normalizeCode(product.part_number);
  const realPart = productPart && !isPlaceholderPartNumber(product.part_number);
  const productOem = normalizeCode(product.oem_number);
  const others = new Set((product.other_numbers ?? []).map(normalizeCode).filter(Boolean));

  if (linePart && realPart && productPart === linePart) return `part number ${line.part_number}`;
  if (linePart && productOem && productOem === linePart) return `OEM number ${line.part_number}`;
  if (linePart && others.has(linePart)) return `other number ${line.part_number}`;
  if (lineOem && productOem && productOem === lineOem) return `OEM number ${line.oem_number}`;
  if (lineOem && realPart && productPart === lineOem) return `part number ${line.oem_number}`;
  if (lineOem && others.has(lineOem)) return `other number ${line.oem_number}`;
  return null;
}

/**
 * One part out of every part a line could be, decided by the brand on the bill.
 *
 * Since October 2026 one number can be kept in several brands, each its own item. The bill's brand
 * picks between them; with no brand on the bill, or one that matches none, the owner picks, because
 * booking a Fleetguard filter into the JCB filter's stock puts the wrong cost on the wrong shelf. A
 * single match whose brand plainly differs from the bill's is also asked about: it is more likely
 * the same part from another maker, a new item of its own.
 */
function decideByBrand(candidates: Array<{ product: MatchableProduct; reason: string }>, line: ImportedLine): LineMatch {
  const billBrand = (line.brand ?? '').trim();
  if (candidates.length === 1) {
    const [only] = candidates;
    if (brandsAgree(only.product.brand, billBrand)) return { kind: 'exact', ...only };
    return {
      kind: 'suggested',
      product: only.product,
      reason: `${only.reason}, but this bill says ${billBrand} and yours is ${only.product.brand}`,
    };
  }
  const sameBrand = billBrand ? candidates.filter((candidate) => brandKey(candidate.product.brand) && brandsAgree(candidate.product.brand, billBrand)) : [];
  if (sameBrand.length === 1) {
    return { kind: 'exact', product: sameBrand[0].product, reason: `${sameBrand[0].reason}, ${sameBrand[0].product.brand}` };
  }
  const brands = candidates.map((candidate) => candidate.product.brand?.trim() || 'no brand').join(', ');
  const [first, ...rest] = candidates;
  return {
    kind: 'suggested',
    product: first.product,
    others: rest.map((candidate) => candidate.product),
    reason: `${first.reason} is kept in ${candidates.length} brands (${brands}). Which one is this?`,
  };
}

export function matchImportedLine(line: ImportedLine, products: MatchableProduct[]): LineMatch {
  // Identifiers first: the part number, the OEM number and the part's other numbers.
  const byNumber = products
    .map((product) => ({ product, reason: identifierReason(product, line) }))
    .filter((candidate): candidate is { product: MatchableProduct; reason: string } => candidate.reason !== null);
  if (byNumber.length > 0) return decideByBrand(byNumber, line);

  const byText = matchImportedProducts(line.description, products);
  if (byText.length > 0) return decideByBrand(byText.map((product) => ({ product, reason: 'the name matches exactly' })), line);

  // Nothing identified it, so fall back to how the words read — as a suggestion only.
  let best: { product: MatchableProduct; score: number } | null = null;
  for (const product of products) {
    const score = Math.max(nameSimilarity(line.description, product.name), nameSimilarity(line.description, `${product.part_number} ${product.name}`));
    if (score >= SUGGESTION_THRESHOLD && (!best || score > best.score)) best = { product, score };
  }
  if (best) return { kind: 'suggested', product: best.product, reason: `the names are ${Math.round(best.score * 100)}% alike` };

  return { kind: 'none' };
}

/** Which blank fields on an existing part this invoice line can fill in, and where the two
 *  disagree. Filling only blanks is the whole point: anything the owner has already entered by
 *  hand outranks whatever a supplier chose to print, so a disagreement is reported, never applied. */
export type FieldPlan = { fills: Record<string, string | number | string[]>; filled: string[]; conflicts: string[] };

export function planFieldUpdates(line: ImportedLine, product: MatchableProduct): FieldPlan {
  const fills: Record<string, string | number | string[]> = {};
  const filled: string[] = [];
  const conflicts: string[] = [];
  // The numbers the part will answer to after this, so one bill never adds the same number twice.
  const known = codesOf(product);
  const learned: string[] = [];

  const consider = (label: string, field: 'part_number' | 'oem_number' | 'brand' | 'hsn_code', incoming: string | null | undefined) => {
    const value = (incoming ?? '').trim();
    if (!value) return;
    const existing = (product[field] ?? '').trim();
    const replaceable = !existing || (field === 'part_number' && isPlaceholderPartNumber(existing));
    if (replaceable) {
      fills[field] = value;
      filled.push(label);
      known.add(partCode(value));
      return;
    }
    if (normalizeCode(existing) !== normalizeCode(value)) {
      // A number the supplier prints for this part that it does not carry yet is another of its
      // numbers, kept so the next bill, a search or a scan finds the part by it. The owner's own
      // number is never replaced.
      if ((field === 'part_number' || field === 'oem_number') && !known.has(partCode(value))) {
        known.add(partCode(value));
        learned.push(value);
        return;
      }
      if (field === 'part_number' || field === 'oem_number') return;
      conflicts.push(`${label}: invoice says "${value}", inventory has "${existing}" — kept yours`);
    }
  };

  consider('Part number', 'part_number', line.part_number);
  consider('OEM number', 'oem_number', line.oem_number);
  consider('Brand', 'brand', line.brand);
  consider('HSN code', 'hsn_code', line.hsn_code);
  if (learned.length > 0) {
    fills.other_numbers = [...(product.other_numbers ?? []), ...learned];
    filled.push(`${learned.length === 1 ? 'Other number' : 'Other numbers'} ${learned.join(', ')}`);
  }

  if (Number(product.cost_price) <= 0 && line.unit_price > 0) {
    fills.cost_price = line.unit_price;
    filled.push('Cost price');
  }

  return { fills, filled, conflicts };
}

