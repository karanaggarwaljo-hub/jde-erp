/** Reading the lines of a return request, before any of it reaches the database.
 *
 *  Two things are decided here and nowhere else. A quantity has to be a positive whole number of
 *  units — half a bearing does not come back, and a negative one would credit the customer for
 *  goods they never returned. And a line's condition decides whether those goods go back on the
 *  sellable shelf: anything other than the one word 'damaged' is read as resellable, so a
 *  malformed or missing condition can never quietly stop stock being restored.
 */

export type ReturnCondition = 'resellable' | 'damaged';

export type ReturnLine = {
  invoice_item_id: string;
  qty: number;
  condition: ReturnCondition;
};

export type ParsedReturnLines =
  | { ok: true; lines: ReturnLine[] }
  | { ok: false; error: string };

function readCondition(value: unknown): ReturnCondition {
  return value === 'damaged' ? 'damaged' : 'resellable';
}

export function parseReturnLines(raw: unknown): ParsedReturnLines {
  const rows = Array.isArray(raw) ? raw : [];
  const lines: ReturnLine[] = [];

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const line = row as Record<string, unknown>;
    const invoiceItemId = typeof line.invoice_item_id === 'string' ? line.invoice_item_id : '';
    const qty = Number(line.qty);
    if (!invoiceItemId || !Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) continue;
    lines.push({ invoice_item_id: invoiceItemId, qty, condition: readCondition(line.condition) });
  }

  // A dropped line means the request was malformed, not that the rest should go ahead: a return
  // that silently credits fewer goods than the person selected is worse than one that fails.
  if (lines.length === 0 || lines.length !== rows.length) {
    return { ok: false, error: 'Select one or more whole-number quantities to return.' };
  }
  if (new Set(lines.map((line) => line.invoice_item_id)).size !== lines.length) {
    return { ok: false, error: 'Each invoice line may appear only once in a return.' };
  }
  return { ok: true, lines };
}

/** How many of the units coming back cannot be sold again. Used to say what will happen to stock
 *  before it happens, and to record it afterwards. */
export function damagedUnits(lines: ReturnLine[]): number {
  return lines.filter((line) => line.condition === 'damaged').reduce((total, line) => total + line.qty, 0);
}
