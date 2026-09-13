/**
 * Opening an entry form straight from the Day Book, and coming back to it once the entry is saved.
 *
 * The Day Book's buttons used to only take you to the Sales, Purchases or Expenses screen. There the
 * form still had to be found and opened, and nothing brought you back to the Day Book afterwards to
 * see what you had just recorded. The owner found recording from there hard. A link now says which
 * form to open and where to return, and each screen acts on it once, then clears it from the address
 * so a refresh does not open the form a second time.
 */

export type EntryKind = 'sale' | 'payment-in' | 'purchase' | 'supplier-payment' | 'expense';

const ROUTES: Record<EntryKind, { path: string; record: string }> = {
  sale: { path: '/sales', record: 'sale' },
  'payment-in': { path: '/sales', record: 'payment' },
  purchase: { path: '/purchases', record: 'purchase' },
  'supplier-payment': { path: '/suppliers', record: 'payment' },
  expense: { path: '/expenses', record: 'expense' },
};

/** The only places a screen may send someone back to. A value read from an address is never used as
 *  a destination itself, so a crafted link cannot send anyone somewhere else after they save. */
const RETURN_PLACES = { daybook: '/daybook' } as const;
export type ReturnPlace = keyof typeof RETURN_PLACES;

/** The link that opens a form for this kind of entry and returns to `back` once it is saved. */
export function entryLink(kind: EntryKind, back: ReturnPlace = 'daybook'): string {
  const { path, record } = ROUTES[kind];
  return `${path}?record=${record}&back=${back}`;
}

export type EntryIntent<T extends string> = {
  /** Which form to open, or null when the address asks for none this screen has. */
  record: T | null;
  /** Where to go once the entry is saved, or null to stay on the screen as before. */
  returnTo: string | null;
};

/** Reads what an address asks for, keeping only values this screen understands. */
export function parseEntryIntent<T extends string>(
  search: string | URLSearchParams,
  allowed: readonly T[]
): EntryIntent<T> {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const record = params.get('record');
  const back = params.get('back');
  return {
    record: record !== null && (allowed as readonly string[]).includes(record) ? (record as T) : null,
    returnTo: back !== null && Object.prototype.hasOwnProperty.call(RETURN_PLACES, back)
      ? RETURN_PLACES[back as ReturnPlace]
      : null,
  };
}

/** The same address without the entry request in it, so a refresh or a shared link does not open
 *  the form again. Everything else in the address is kept. */
export function withoutEntryIntent(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete('record');
  params.delete('back');
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}
