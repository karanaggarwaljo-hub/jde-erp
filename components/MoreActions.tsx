'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * A "More" button holding a screen's occasional actions, so its title row shows only the one thing
 * people come to it for. The owner found screens cluttered with four or five buttons side by side.
 *
 * Built on <details>, so it opens and closes without any state of its own. It closes again when an
 * action inside it is chosen, when you click anywhere else, or on Escape. An action that is a
 * <label> around a hidden file input still opens the file dialog: the input stays in the page, only
 * the list is hidden.
 */
export default function MoreActions({ children, label = 'More' }: { children: ReactNode; label?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = () => { if (ref.current) ref.current.open = false; };
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <details ref={ref} className="more-actions">
      <summary className="btn btn-secondary">{label} <ChevronDown size={16} aria-hidden="true" /></summary>
      {/* Closed a tick after the click, once the chosen action (a link, a button or a file picker)
          has had the click. */}
      <div className="more-actions-menu" onClick={() => setTimeout(() => { if (ref.current) ref.current.open = false; }, 0)}>
        {children}
      </div>
    </details>
  );
}
