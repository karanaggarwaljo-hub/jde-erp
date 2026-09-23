/**
 * Which list a Website Catalog entry belongs in, so the screen shows one list at a time instead of
 * every entry and every part not yet in the catalog stacked together.
 *
 * "Live" means exactly what the public website shows: publication_status 'published', the same test
 * the database's row-level policy applies. So the count on the Live tab is what a customer can see.
 */

import { matchesProductSearch } from './product-search';

export type CatalogTab = 'live' | 'not-live' | 'not-added';

type CatalogRowLike = {
  id: string;
  erp_product_id?: string | null;
  title?: string | null;
  part_number?: string | null;
  oem_number?: string | null;
  brand?: string | null;
  category?: string | null;
  compatibility?: string | null;
  publication_status?: string | null;
};

type ProductLike = {
  id: string;
  name?: string | null;
  part_number?: string | null;
  oem_number?: string | null;
  brand?: string | null;
  category?: string | null;
  compatibility?: string | null;
};

export function isLiveOnWebsite(row: { publication_status?: string | null }): boolean {
  return row.publication_status === 'published';
}

/** The three lists, each narrowed by the same search — which reads a catalog entry's title as its
 *  name, and ignores punctuation in part numbers just as Inventory's search does. */
export function splitCatalog<R extends CatalogRowLike, P extends ProductLike>(rows: R[], products: P[], query: string) {
  const matchesRow = (row: R) => matchesProductSearch({ ...row, name: row.title }, query);
  // Any entry at all — even one taken down — means the part is not "waiting to be added".
  const catalogued = new Set(rows.map((row) => row.erp_product_id).filter(Boolean));
  return {
    live: rows.filter((row) => isLiveOnWebsite(row) && matchesRow(row)),
    notLive: rows.filter((row) => !isLiveOnWebsite(row) && matchesRow(row)),
    notAdded: products.filter((product) => !catalogued.has(product.id) && matchesProductSearch(product, query)),
  };
}

/** The tab to open on: the first with anything in it, so the screen never opens on an empty list. */
export function firstUsefulTab(counts: Record<CatalogTab, number>): CatalogTab {
  if (counts.live > 0) return 'live';
  if (counts['not-live'] > 0) return 'not-live';
  return 'not-added';
}
