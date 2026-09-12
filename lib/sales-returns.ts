/**
 * Spotting a return that was recorded more than once.
 *
 * Three identical credit notes sat against INV-1013 in the live data for over a week — SRN-1003,
 * SRN-1004 and SRN-1005, the same two lines, ₹3,500 each, five and nine minutes apart. Each one
 * put the goods back on the shelf, so one bearing and two gears came back on paper three times.
 *
 * Nothing surfaced it, because credit notes had no screen: they were counted, never listed. The
 * rule below is what the Credit Notes tab uses to say so on the row itself, rather than leaving
 * it to somebody to notice that two lines look alike.
 *
 * Deliberately not a hard rule that blocks anything. A customer genuinely can bring back the same
 * part twice off the same invoice on the same day. This says "these look like one return entered
 * twice" and leaves the judgement where it belongs.
 */

export type CreditNoteLike = {
  id: string;
  invoice_id: string;
  credit_total: number | string;
};

function amount(value: number | string): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The other credit notes that look like this one: same invoice, same amount to the paisa.
 *
 * Excludes the note itself, so an ordinary one-off return comes back empty and its row stays
 * quiet. Amount is compared as a number because the database hands numerics over as strings, and
 * "3500.00" must match 3500.
 */
export function duplicateCreditNotes<T extends CreditNoteLike>(credit: CreditNoteLike, all: T[]): T[] {
  return all.filter((other) =>
    other.id !== credit.id &&
    other.invoice_id === credit.invoice_id &&
    amount(other.credit_total) === amount(credit.credit_total));
}
