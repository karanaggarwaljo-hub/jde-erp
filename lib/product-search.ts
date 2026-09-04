/** Finding a part in Inventory.
 *
 *  Two things this fixes, both found by looking at the real data rather than guessing:
 *
 *  1. Compatibility was not searched at all. Recording that a filter "fits JCB 3DX BS4" is only
 *     worth doing if, when a JCB 3DX BS4 rolls into the yard, typing "3DX" finds it. It didn't.
 *
 *  2. The shop writes the same thing several ways. Of the nine parts that had compatibility
 *     filled in, four were the same machine spelled differently — "N/m bs4", "N/M bs4",
 *     "JCB N/M (bs4)", "Jcb BS4 & 5 in n/m". Plain substring matching finds one and misses three.
 *     Part numbers have the same problem: "331/34392" typed as "331-34392" found nothing.
 *
 *  So code-like fields — part number, OEM number, compatibility — are also compared with
 *  punctuation and spacing removed, exactly as the import matcher already does. Names and brands
 *  are prose and stay plain substring: stripping punctuation there would merge different parts.
 */

export type SearchableProduct = {
  name?: string | null;
  part_number?: string | null;
  oem_number?: string | null;
  brand?: string | null;
  compatibility?: string | null;
  category?: string | null;
};

const plain = (value: unknown): string => (typeof value === 'string' ? value.toLowerCase() : '');

/** Punctuation and case carry no meaning in a code or a machine model, so drop both:
 *  "BS 4", "bs-4" and "BS4" are one thing, and so are "331/34392" and "331-34392". */
const squashed = (value: unknown): string => plain(value).replace(/[^a-z0-9]/g, '');

/** The fields compared with punctuation removed as well as plainly. */
const CODE_FIELDS: (keyof SearchableProduct)[] = ['part_number', 'oem_number', 'compatibility'];
/** The fields compared as written — prose, where punctuation separates real meaning. */
const TEXT_FIELDS: (keyof SearchableProduct)[] = ['name', 'brand', 'category', 'compatibility'];

export function matchesProductSearch(product: SearchableProduct, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;

  for (const field of TEXT_FIELDS) {
    if (plain(product[field]).includes(term)) return true;
  }

  // A search that is nothing but punctuation would squash to an empty string, which every
  // product would then "contain" — so only compare when something is left of it.
  const squashedTerm = squashed(term);
  if (!squashedTerm) return false;

  for (const field of CODE_FIELDS) {
    if (squashed(product[field]).includes(squashedTerm)) return true;
  }
  return false;
}

/** Every distinct compatibility already in use, most-used first, for offering as suggestions
 *  when someone fills the field in. Reusing an existing spelling is what stops the same machine
 *  being recorded four different ways — the field stays free text, this only makes the spellings
 *  the shop already uses the easiest thing to pick. */
export function compatibilitySuggestions(products: SearchableProduct[], limit = 30): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const product of products) {
    const value = typeof product.compatibility === 'string' ? product.compatibility.trim() : '';
    if (!value) continue;
    const key = squashed(value);
    if (!key) continue;
    const seen = counts.get(key);
    // Keep the first spelling met, so the list is stable rather than reshuffling on every edit.
    if (seen) seen.n += 1;
    else counts.set(key, { label: value, n: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((entry) => entry.label);
}
