/**
 * The row and form shapes the Inventory screen shares with its dialogs.
 *
 * These were declared inside app/(dashboard)/inventory/page.tsx while everything lived in that one
 * file. Now that the add/edit dialog, the delete confirmation and the import dialog are their own
 * components, the shapes have to be named somewhere both sides can see — and the sales screens
 * already set the precedent in lib/sales-types.ts: one definition per shape, rather than a copy
 * per file that someone has to remember to keep in step.
 *
 * Shapes only — no logic, so nothing here can change behaviour.
 */

import type { ImportedProduct, SheetForCostUpdate } from './client-import';

/** A part exactly as the products table stores it. */
export type Product = {
  id: string;
  company_id: string;
  part_number: string;
  oem_number: string;
  hsn_code: string;
  name: string;
  brand: string;
  category: string;
  compatibility: string;
  cost_price: number;
  mrp: number;
  sale_price: number;
  current_stock: number;
  min_stock: number;
  location: string;
};

/** What is currently typed into the add/edit dialog. Every field is a string because it is what an
 *  <input> holds; the numbers are converted once, on save. */
export type PartFormData = {
  part_number: string;
  oem_number: string;
  hsn_code: string;
  name: string;
  brand: string;
  category: string;
  compatibility: string;
  cost_price: string;
  mrp: string;
  sale_price: string;
  current_stock: string;
  min_stock: string;
  location: string;
};

/** Everything the dialog's live summary panel shows, worked out from what is currently typed.
 *  Nothing here is stored or guessed — an empty field simply produces an empty readout. */
export type PartDraftSummary = {
  name: string;
  partNumber: string;
  brand: string;
  category: string;
  cost: number;
  sale: number;
  mrp: number;
  stock: number;
  isLow: boolean;
  stockValue: number;
  /** Null when the part has no reorder level, because then the bar has no meaningful scale. */
  meterPercent: number | null;
  stockBadge: { label: string; tone: string };
  warnings: Array<{ text: string; tone: string }>;
};

/** The three jobs one imported file can be put to. Which is proposed comes from the file's own
 *  content, but it always stays the owner's choice. */
export type ImportMode = 'costs' | 'new' | 'details';

/** A file the owner has chosen to import, read once and held while they decide what it should do.
 *  Both readings are taken up front so the dialog can offer either job — and switch between them —
 *  without re-uploading. */
export type CostSheetImport = {
  fileName: string;
  sheet: SheetForCostUpdate;
  newParts: ImportedProduct[];
  guessedFields: string[];
};
