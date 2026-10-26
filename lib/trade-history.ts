/**
 * What a part last changed hands for with one particular counterparty.
 *
 * "What did I charge him last time?" and "what did I pay them last time?" are the same question
 * asked from the two sides of the counter, and they are the question actually being asked
 * whenever a rate is typed. One is answered from invoices to a customer, the other from purchase
 * orders to a supplier; the shape of the answer, and the rule for picking which document counts,
 * are identical — so they are one function called with each side's rows mapped in.
 *
 * The rule: only documents belonging to that counterparty, never a draft (nothing was agreed),
 * most recent date wins, and where two share a date the higher document number does — ids are
 * sequential here, so that is genuinely the later of the two rather than an arbitrary pick.
 */

/** One recorded document — an invoice on the sales side, a purchase order on the buying side. */
export type TradedDocument = {
  id: string;
  /** Customer or supplier name, whichever side this is. */
  counterparty: string;
  date: string;
  status: string;
};

/** One line of such a document, reduced to what this needs. */
export type TradedLine = {
  documentId: string;
  partNumber: string;
  name: string;
  /** The part's label where it is known (partLabeler), so two brands of one part keep their own
   *  last price. Without it the label is worked out from the number and name. */
  label?: string;
  /** Unit price on a sale, unit cost on a purchase. */
  rate: number;
};

export type LastTraded = {
  rate: number;
  date: string;
  /** The document the rate came from, so the form can name it rather than assert a bare number. */
  ref: string;
};

/** The label a line carries, and the key everything here matches on. Matches how both edit paths
 *  rebuild lines from saved items, so a reopened document lines up with the catalogue. */
export function partLabel(partNumber: string, name: string): string {
  return `${partNumber} - ${name}`;
}

/** The minimum a part needs to be labelled. */
export type LabelledPart = { id?: string; part_number?: string | null; name?: string | null; brand?: string | null };

/**
 * Each part's label, made unique. Normally "number - name", as it always was. When two parts share
 * both the number and the name, which is how the same part is kept in two brands (October 2026),
 * each of them gets its brand added: "320/A7291 - Water Separator (JCB)". Lines on a bill or a
 * purchase are matched back to their part by this label, so two identical labels would always have
 * billed the first brand. Parts with no twin keep their label unchanged, so nothing else moves.
 */
export function partLabeler(parts: readonly LabelledPart[]): (part: LabelledPart) => string {
  const counts = new Map<string, number>();
  for (const part of parts) {
    const base = partLabel(part.part_number ?? '', part.name ?? '');
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  return (part) => {
    const base = partLabel(part.part_number ?? '', part.name ?? '');
    const brand = String(part.brand ?? '').trim();
    return (counts.get(base) ?? 0) > 1 && brand ? `${base} (${brand})` : base;
  };
}

export function buildLastTradedIndex(
  counterparty: string,
  documents: TradedDocument[],
  lines: TradedLine[],
  draftStatus = 'draft'
): Map<string, LastTraded> {
  const index = new Map<string, LastTraded>();
  if (!counterparty) return index;

  const settled = new Map<string, TradedDocument>();
  for (const document of documents) {
    if (document.counterparty !== counterparty) continue;
    if (document.status === draftStatus) continue;
    settled.set(document.id, document);
  }
  if (settled.size === 0) return index;

  for (const line of lines) {
    const document = settled.get(line.documentId);
    if (!document) continue;
    if (!Number.isFinite(line.rate)) continue;

    const key = line.label ?? partLabel(line.partNumber, line.name);
    const previous = index.get(key);
    const isNewer =
      !previous ||
      document.date > previous.date ||
      (document.date === previous.date && document.id > previous.ref);
    if (isNewer) index.set(key, { rate: line.rate, date: document.date, ref: document.id });
  }
  return index;
}

/** A part's current number, name and label, looked up by id. */
export type NamedPart = { part_number: string; name: string; label: string };

/** Products by id, so a saved line can be traced to the part it was for. */
export function indexProductsById<T extends { id: string; part_number?: string | null; name?: string | null; brand?: string | null }>(products: T[]): Map<string, NamedPart> {
  const labelOf = partLabeler(products);
  const index = new Map<string, NamedPart>();
  for (const product of products) {
    index.set(product.id, { part_number: product.part_number ?? '', name: product.name ?? '', label: labelOf(product) });
  }
  return index;
}

/**
 * A saved invoice, quotation or purchase line, carrying the part's CURRENT number and name.
 *
 * Lines store the number and name as they were on the day, as text. That is right for the document
 * itself: an invoice already handed to a customer must not change. But everything that works out
 * which part a line WAS for compared that old text against today's catalogue. The day a part is
 * renamed, or its made-up code is replaced with the real one, the two stop matching. Reopening an
 * old invoice to edit it would then save its lines as one-off text with no part behind them, so no
 * stock would move, and the last-price hints would go blank for that part.
 *
 * A line's product_id never changes, so it is used whenever it still points at a part. A line with
 * no part behind it, or whose part has since been deleted, keeps its saved text.
 */
export function currentIdentity<T extends { product_id?: string | null; part_number: string; name: string }>(item: T, byId: Map<string, NamedPart>): T & { label?: string } {
  const current = item.product_id ? byId.get(item.product_id) : undefined;
  return current ? { ...item, part_number: current.part_number, name: current.name, label: current.label } : item;
}

/** The picker label for a saved line, under the part's current label where it has one. */
export function savedLineLabel(item: { product_id?: string | null; part_number: string; name: string }, byId: Map<string, NamedPart>): string {
  const current = currentIdentity(item, byId);
  return current.label ?? partLabel(current.part_number, current.name);
}
