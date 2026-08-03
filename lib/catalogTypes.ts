export type ReferenceCandidate = {
  kind: 'image' | 'web';
  url: string;
  sourceUrl?: string;
  title: string;
  domain: string;
  verdict?: 'useful' | 'wrong' | 'uncertain';
};

export type GeneratedDescription = {
  title: string;
  short_description: string;
  key_features: string[];
  compatible_machines: string[];
  search_keywords: string[];
  warnings: string[];
};

export type CatalogProduct = {
  id: string;
  company_id: string;
  erp_product_id: string;
  title: string;
  description: string;
  category: string;
  brand: string;
  part_number: string;
  oem_number: string;
  compatibility: string;
  price: number | null;
  availability: 'in_stock' | 'out_of_stock' | 'contact_for_availability';
  image_url: string | null;
  image_status: 'needs_image' | 'generating' | 'ready' | 'failed';
  publication_status: 'draft' | 'needs_review' | 'published' | 'unpublished' | 'archived';
  generated_prompt: string | null;
  generation_error: string | null;
  reviewer: string | null;
  published_at: string | null;
  reference_query: string | null;
  reference_candidates: ReferenceCandidate[] | null;
  selected_reference_url: string | null;
  generated_description: GeneratedDescription | null;
  created_at: string;
  updated_at: string;
};

const REQUIRED_FIELD_LABELS: Array<[keyof CatalogProduct, string]> = [
  ['title', 'Product name'],
  ['part_number', 'Part number'],
  ['category', 'Category'],
];

/** The PRD's "Required product fields" for publishing, minus the image (checked separately via
 *  image_status, since that's a workflow step of its own, not a plain text field). */
export function missingRequiredFields(row: CatalogProduct): string[] {
  const missing = REQUIRED_FIELD_LABELS.filter(([key]) => !String(row[key] ?? '').trim()).map(([, label]) => label);
  if (!row.oem_number?.trim() && !row.compatibility?.trim() && !row.description?.trim()) {
    missing.push('OEM number, compatibility, or description (at least one)');
  }
  return missing;
}

/** Computes the PRD's 7-label catalog status from the two stored axes (publication_status,
 *  image_status) plus whether a reference has been picked — see plan decision #1: the DB keeps
 *  two independent axes rather than one flat enum, and this derives the display label from them.
 *  A missing reference is a soft nudge only (not in the PRD's required-fields list), so it's
 *  checked after the image, not before. */
export function catalogDisplayStatus(row: CatalogProduct): { label: string; cls: string } {
  if (row.publication_status === 'published') return { label: 'Published', cls: 'badge-success' };
  if (row.publication_status === 'unpublished') return { label: 'Unpublished', cls: 'badge-muted' };
  if (row.publication_status === 'archived') return { label: 'Archived', cls: 'badge-muted' };
  if (missingRequiredFields(row).length > 0) return { label: 'Draft', cls: 'badge-muted' };
  if (row.image_status !== 'ready') return { label: 'Needs Image', cls: 'badge-warning' };
  if (!row.selected_reference_url) return { label: 'Needs Reference', cls: 'badge-warning' };
  return { label: 'Needs Review', cls: 'badge-info' };
}

export function canPublish(row: CatalogProduct): boolean {
  return missingRequiredFields(row).length === 0 && row.image_status === 'ready';
}
