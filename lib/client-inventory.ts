/** Browser-side calls for Inventory that must not be done as several separate requests. */

export type CreatePartInput = {
  companyId: string;
  /** The part's fields. Leave `part_number` blank to have the database pick the next free code
   *  for this company — it is the only place that can see every code already in use. */
  product: Record<string, unknown>;
  openingQty: number;
  openingCost: number;
};

/** Creates a part and its opening stock batch in one database transaction, instead of an insert
 *  followed by a separate batch call that could fail on its own. */
export async function createPart(input: CreatePartInput): Promise<Record<string, unknown>> {
  const res = await fetch('/api/inventory/parts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  let parsed: unknown;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // A non-JSON body (an HTML error page, say) falls through to the status-based message.
    }
  }
  if (!res.ok) {
    const message = parsed && typeof parsed === 'object' && 'error' in parsed && typeof (parsed as { error: unknown }).error === 'string'
      ? (parsed as { error: string }).error
      : `Could not add this part (${res.status})`;
    throw new Error(message);
  }
  return parsed as Record<string, unknown>;
}
