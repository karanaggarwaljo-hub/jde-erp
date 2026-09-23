/** Whether the side menu is hidden, remembered per browser.
 *
 *  Kept outside React so the chrome can read it with useSyncExternalStore: the server has no
 *  browser storage, so the first HTML always shows the menu, and the browser's own answer is
 *  applied straight after. Reading it into state from an effect instead would both fight the
 *  hydrated markup and trip the set-state-in-effect rule.
 *
 *  Every read and write is wrapped: a browser set to block site data throws on the property
 *  itself, not only on the call, and a menu that cannot be remembered must still work today.
 */
const KEY = 'jde.nav-hidden';

type ReadableStore = { getItem(key: string): string | null };
type WritableStore = ReadableStore & { setItem(key: string, value: string): void };

function browserStore(): WritableStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

export function readNavHidden(store: ReadableStore | null = browserStore()): boolean {
  try {
    return store?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function writeNavHidden(hidden: boolean, store: WritableStore | null = browserStore()): void {
  try {
    store?.setItem(KEY, hidden ? '1' : '0');
  } catch {
    // Not remembered in this browser. The menu still hides for this visit.
  }
  for (const listener of [...listeners]) listener();
}

export function subscribeNavHidden(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab of the same ERP hiding or showing its menu.
  globalThis.addEventListener?.('storage', listener);
  return () => {
    listeners.delete(listener);
    globalThis.removeEventListener?.('storage', listener);
  };
}

/** No browser storage on the server, so the menu is always shown in the first HTML. */
export function navHiddenOnServer(): boolean {
  return false;
}
