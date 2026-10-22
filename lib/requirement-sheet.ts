/**
 * The requirement sheet: the list of parts to order, how many of each, and from whom. The owner
 * found the old reorder screen too complicated to make a plan with (three day settings and no way
 * to add a part or change a quantity), so planning is now one list:
 *
 *   - it starts filled with what is running low (lib/stock-planning.ts works that out),
 *   - any part can be added, any quantity changed, any line removed,
 *   - and it is printed, sent as text (WhatsApp), or turned into a purchase.
 *
 * Pure; the screen keeps the list (components/StockPlanning.tsx).
 */

import type { PartPlan } from './stock-planning';

export type SheetLine = {
  partId: string;
  partNumber: string;
  name: string;
  qty: number;
  /** Who to order it from: the supplier it was last bought from, or typed in. */
  supplier: string;
};

/** How long an order should last, in plain words, as the one setting the sheet has. */
export const COVER_CHOICES: Array<{ days: number; label: string }> = [
  { days: 15, label: '2 weeks' },
  { days: 30, label: '1 month' },
  { days: 60, label: '2 months' },
];

/** What the shelf is short of, as sheet lines, most urgent first (the order reorderList gives). */
export function suggestedLines(toOrder: PartPlan[]): SheetLine[] {
  return toOrder.map((plan) => ({
    partId: plan.partId,
    partNumber: plan.partNumber,
    name: plan.name,
    qty: Math.max(1, plan.suggestQty),
    supplier: plan.lastSupplier ?? '',
  }));
}

/** A whole number of pieces, at least one. */
export function cleanQty(value: unknown): number {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, 99_999) : 1;
}

/** Adds a part to the sheet; a part already on it gets the new quantity added instead of a second
 *  line, so the sheet never lists a part twice. */
export function addLine(lines: SheetLine[], line: SheetLine): SheetLine[] {
  const at = lines.findIndex((existing) => existing.partId === line.partId);
  if (at < 0) return [...lines, { ...line, qty: cleanQty(line.qty) }];
  return lines.map((existing, index) => (index === at ? { ...existing, qty: cleanQty(existing.qty + line.qty), supplier: existing.supplier || line.supplier } : existing));
}

/** Puts the suggestions on the sheet without touching anything already there: a part already on
 *  it keeps the quantity the owner set. */
export function addSuggestions(lines: SheetLine[], suggestions: SheetLine[]): SheetLine[] {
  const have = new Set(lines.map((line) => line.partId));
  return [...lines, ...suggestions.filter((line) => !have.has(line.partId))];
}

/** The suppliers on the sheet, by name, with "no supplier" last. */
export function sheetSuppliers(lines: SheetLine[]): string[] {
  const names = [...new Set(lines.map((line) => line.supplier.trim()))];
  return names.sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b));
}

/** The sheet as plain text, for WhatsApp or a message: a heading, then one numbered line a part. */
export function sheetText(input: { company: string; date: string; supplier?: string; lines: SheetLine[] }): string {
  const heading = [
    `*Requirement - ${input.company}*`,
    input.date,
    input.supplier ? `For: ${input.supplier}` : '',
  ].filter(Boolean);
  const body = input.lines.map((line, index) => `${index + 1}. ${line.partNumber ? `${line.partNumber} - ` : ''}${line.name} - ${line.qty} pcs`);
  const total = input.lines.reduce((sum, line) => sum + line.qty, 0);
  return [...heading, '', ...body, '', `Total: ${input.lines.length} item${input.lines.length === 1 ? '' : 's'}, ${total} pcs`].join('\n');
}

/** What is kept between visits, read back defensively: a bad or old entry gives an empty sheet. */
export function readSavedSheet(raw: string | null): SheetLine[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((line): line is SheetLine => Boolean(line) && typeof line === 'object' && typeof (line as SheetLine).partId === 'string' && typeof (line as SheetLine).name === 'string')
      .map((line) => ({ partId: line.partId, partNumber: String(line.partNumber ?? ''), name: line.name, qty: cleanQty(line.qty), supplier: String(line.supplier ?? '') }));
  } catch {
    return null;
  }
}
