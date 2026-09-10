/**
 * The shapes the Purchases screen shares with the dialogs that were lifted out of it
 * (components/purchases/*). Same reasoning as lib/sales-types.ts: a shape that lives in two files
 * is a shape somebody eventually updates in only one of them.
 *
 * Only what genuinely crosses the boundary is here. Shapes the page alone uses — its product row,
 * its GRN row, its tab and filter unions — stay in the page, because moving them would say they
 * are shared when they are not.
 *
 * Shapes and one constant, no logic, so nothing here can change behaviour.
 */

import type { ImportedLine } from '@/lib/client-import';
import type { LineMatch, MatchableProduct } from '@/lib/import-matching';

/** How a purchase was settled at the moment it was recorded. Same three words the sales side uses
 *  for a bill, read from the supplier's side of the counter. */
export type PaymentStatus = 'paid' | 'partial' | 'unpaid';

/** One typed line on the manual "Record Purchase" form, before anything is matched to a part. */
export type POLine = { description: string; quantity: number; unit_price: number };

export type Supplier = { id: string; company_id: string; name: string; balance: number };

export type PurchaseOrder = { id: string; company_id: string; supplier: string; date: string; expected: string; items: number; total: number; paid: number; status: string };

export type PoItem = { id: string; po_id: string; product_id: string | null; part_number: string; name: string; qty: number; unit_cost: number };

/** A part as offered by the picker on this screen: what makes it findable, plus what the row
 *  shows once it is on the purchase. `price` is the cost, the rate that fills into a new line,
 *  and `salePrice` is what the part sells for, so a cost typed at or above it can be flagged.
 *  Structurally satisfies PickablePart in components/PartPicker.tsx. */
export type PartOption = {
  value: string;
  price: number;
  salePrice: number;
  category: string;
  partNumber: string;
  name: string;
  brand: string;
  stock: number;
};

/** A supplier document that has been read but not yet recorded — everything the review dialog
 *  needs to show it, correct it and save it. `fileHash` is null for a spreadsheet, which is not
 *  checked for having been imported before; a scanned PDF or photo always carries one. */
export type ImportPreview = {
  fileName: string;
  lines: ImportedLine[];
  supplier: string;
  supplierGstin: string;
  fileHash: string | null;
};

/** What the review screen concluded about one line of a supplier document. */
export type ImportLineReview = {
  match: LineMatch;
  /** The part this line will actually be recorded against — after any owner decision. */
  matchedProduct: MatchableProduct | null;
  /** True while a suggested match is still waiting on Link / Keep separate. */
  needsDecision: boolean;
  warnings: string[];
  /** Fields where the invoice disagrees with data already on the part. Reported, never applied. */
  conflicts: string[];
  /** Blank fields on the existing part that this invoice will fill in. */
  fills: string[];
  costDifferencePercent: number | null;
};

/** The value stored in the link map when the owner has looked at a suggestion and rejected it —
 *  distinct from "not yet decided", which is what an absent entry means. */
export const NEW_PART = 'new';
