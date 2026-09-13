'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseEntryIntent, withoutEntryIntent } from '@/lib/entry-intent';

/**
 * Lets a screen open one of its entry forms when it is arrived at from the Day Book's Record tiles,
 * and send the owner back there once the entry is saved. See lib/entry-intent.ts for why.
 *
 * The address is read once, when the screen first appears, straight from window.location rather
 * than through Next's useSearchParams. On a page Next pre-renders, that hook needs a Suspense
 * wrapper or the production build fails, and one read on arrival is all this needs anyway.
 *
 * `allowed` must be a constant defined outside the component, so it is the same array every render.
 * `finishEntry` does nothing unless the screen was opened from the Day Book, so calling it after
 * every successful save leaves ordinary use of the screen exactly as it was.
 */
export function useEntryIntent<T extends string>(allowed: readonly T[], onRecord: (record: T) => void) {
  const router = useRouter();
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const handled = useRef(false);
  const onRecordRef = useRef(onRecord);

  useEffect(() => {
    onRecordRef.current = onRecord;
  });

  useEffect(() => {
    // Deferred a tick, so the form opens after the screen's own first render has settled, and so a
    // development double-run of this effect cancels the first attempt instead of opening twice.
    const timer = setTimeout(() => {
      if (handled.current) return;
      handled.current = true;
      const intent = parseEntryIntent(window.location.search, allowed);
      if (!intent.record && !intent.returnTo) return;
      // Cleared at once, so a refresh or a copied link does not open the form a second time.
      window.history.replaceState(
        window.history.state,
        '',
        withoutEntryIntent(window.location.pathname, window.location.search)
      );
      if (intent.returnTo) setReturnTo(intent.returnTo);
      if (intent.record) onRecordRef.current(intent.record);
    }, 0);
    return () => clearTimeout(timer);
  }, [allowed]);

  const finishEntry = useCallback(() => {
    if (returnTo) router.push(returnTo);
  }, [returnTo, router]);

  return { returnTo, finishEntry };
}
