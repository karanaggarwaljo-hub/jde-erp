/**
 * What a part's fitment — the machines it fits — means for its Website Catalog listing, which keeps
 * a copy of its own that the public website shows.
 *
 * The listing follows a change to the part when it still says what the part said, or nothing: that
 * is a copy nobody has touched. A listing given its own wording on the catalog page is someone's
 * deliberate choice, and editing the part must never quietly overwrite it.
 */

export type ListingFitment = 'follow' | 'keep' | 'already-same';

export type PartFitmentResult = {
  before: string;
  after: string;
  /** The Website Catalog listing took the new fitment too. */
  listingFollowed: boolean;
  /** The listing's own wording, left alone because someone chose it on the catalog page. */
  listingKept: string | null;
};

const squash = (value: string | null | undefined) => (value ?? '').trim().replace(/\s+/g, ' ');

export function listingFitment(listing: string | null | undefined, partBefore: string | null | undefined, partAfter: string): ListingFitment {
  const own = squash(listing);
  if (own === squash(partAfter)) return 'already-same';
  if (!own || own.toLowerCase() === squash(partBefore).toLowerCase()) return 'follow';
  return 'keep';
}

/** Tidies what was typed: outer spaces and doubled inner spaces go, so the same machines are
 *  always written the same way. */
export function cleanFitment(value: unknown): string {
  return typeof value === 'string' ? squash(value).slice(0, 300) : '';
}
