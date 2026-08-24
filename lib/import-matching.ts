/**
 * Deciding which inventory part an imported invoice line refers to, and what that line can teach
 * an existing part.
 *
 * Kept out of the Purchases page on purpose: this is the logic with real money behind it — the
 * difference between restocking the part you already own and silently creating a duplicate — and
 * it is pure, so it can be exercised directly by scripts/import-matching-check.ts.
 */
import type { ImportedLine } from './client-import';

/** Only the product fields matching cares about, so a caller can pass its own richer row. */
export type MatchableProduct = {
  id: string;
  part_number: string;
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
export function matchImportedProduct(description: string, products: MatchableProduct[]): MatchableProduct | null {
  const trimmed = description.trim();
  const normalized = normalizeImportText(trimmed);
  if (!normalized) return null;

  return products.find((product) => {
    const partNumber = product.part_number.trim();
    const partNumberPrefix = partNumber
      ? new RegExp(`^${partNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s*[-:|]\\s*|\\s*$)`, 'i')
      : null;
    return normalized === normalizeImportText(product.name)
      || normalized === normalizeImportText(`${partNumber} - ${product.name}`)
      || normalized === normalizeImportText(partNumber)
      || Boolean(partNumberPrefix?.test(trimmed));
  }) ?? null;
}

export function normalizeCode(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** "SP-014" and friends are placeholders this app invented during an earlier import because the
 *  source document carried no real code — not something a supplier ever printed. An invoice that
 *  does carry a real part number is therefore allowed to replace one, where it would never be
 *  allowed to overwrite a number the owner actually entered. */
export function isPlaceholderPartNumber(value: string): boolean {
  return /^sp-?\d+$/i.test(value.trim());
}

function nameTokens(value: string): Set<string> {
  return new Set(normalizeImportText(value).split(' ').filter((token) => token.length > 2));
}

/** Dice coefficient over the words of two names: 1 means identical wording, 0 nothing in common. */
export function nameSimilarity(a: string, b: string): number {
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
  | { kind: 'suggested'; product: MatchableProduct; reason: string }
  | { kind: 'none' };

export function matchImportedLine(line: ImportedLine, products: MatchableProduct[]): LineMatch {
  const linePart = normalizeCode(line.part_number);
  const lineOem = normalizeCode(line.oem_number);

  // Identifiers first, and cross-checked: suppliers routinely print an OEM number in their own
  // "part no" column, so a line's part number is compared against both fields and vice versa.
  for (const product of products) {
    const productPart = normalizeCode(product.part_number);
    const productOem = normalizeCode(product.oem_number);
    const realPart = productPart && !isPlaceholderPartNumber(product.part_number);

    if (linePart && realPart && productPart === linePart) return { kind: 'exact', product, reason: `part number ${line.part_number}` };
    if (linePart && productOem && productOem === linePart) return { kind: 'exact', product, reason: `OEM number ${line.part_number}` };
    if (lineOem && productOem && productOem === lineOem) return { kind: 'exact', product, reason: `OEM number ${line.oem_number}` };
    if (lineOem && realPart && productPart === lineOem) return { kind: 'exact', product, reason: `part number ${line.oem_number}` };
  }

  const byText = matchImportedProduct(line.description, products);
  if (byText) return { kind: 'exact', product: byText, reason: 'the name matches exactly' };

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
export type FieldPlan = { fills: Record<string, string | number>; filled: string[]; conflicts: string[] };

export function planFieldUpdates(line: ImportedLine, product: MatchableProduct): FieldPlan {
  const fills: Record<string, string | number> = {};
  const filled: string[] = [];
  const conflicts: string[] = [];

  const consider = (label: string, field: 'part_number' | 'oem_number' | 'brand' | 'hsn_code', incoming: string | null | undefined) => {
    const value = (incoming ?? '').trim();
    if (!value) return;
    const existing = (product[field] ?? '').trim();
    const replaceable = !existing || (field === 'part_number' && isPlaceholderPartNumber(existing));
    if (replaceable) {
      fills[field] = value;
      filled.push(label);
      return;
    }
    if (normalizeCode(existing) !== normalizeCode(value)) {
      conflicts.push(`${label}: invoice says "${value}", inventory has "${existing}" — kept yours`);
    }
  };

  consider('Part number', 'part_number', line.part_number);
  consider('OEM number', 'oem_number', line.oem_number);
  consider('Brand', 'brand', line.brand);
  consider('HSN code', 'hsn_code', line.hsn_code);

  if (Number(product.cost_price) <= 0 && line.unit_price > 0) {
    fills.cost_price = line.unit_price;
    filled.push('Cost price');
  }

  return { fills, filled, conflicts };
}

