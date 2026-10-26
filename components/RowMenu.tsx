'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

export type RowMenuItem = {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  /** Why it cannot be done right now. Set, the item is shown greyed out with this reason under it. */
  disabledReason?: string;
  /** For actions that cannot be undone (cancel, delete): drawn in red. */
  danger?: boolean;
};

/**
 * The "⋯" button at the end of a table row, holding the row's less common actions in words.
 *
 * Rows used to end in seven or eight small icons (edit, return, PDF, cancel, delete…) that only made
 * sense once learnt. The owner asked for an ERP a school child could use, so a row now shows its one
 * or two everyday buttons and keeps the rest here, each with its name, and a greyed-out item says
 * why it is not available instead of only hinting at it on hover.
 *
 * The list is placed against the window rather than inside the table, because the tables sit in
 * boxes that clip anything spilling out of them. It closes on a choice, a click elsewhere, Escape,
 * or when the page scrolls under it.
 */
export default function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top?: number; bottom?: number; right: number } | null>(null);

  useEffect(() => {
    if (!place) return;
    const close = () => setPlace(null);
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [place]);

  const toggle = () => {
    if (place) { setPlace(null); return; }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const right = Math.max(8, window.innerWidth - rect.right);
    // Opens upwards from a row near the bottom of the window, so the list is never cut off there.
    const roughHeight = items.length * 52 + 12;
    setPlace(rect.bottom + roughHeight > window.innerHeight - 8
      ? { bottom: window.innerHeight - rect.top + 4, right }
      : { top: rect.bottom + 4, right });
  };

  if (items.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-ghost btn-sm"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={place !== null}
        onClick={toggle}
      >
        <MoreHorizontal size={16} />
      </button>
      {place && (
        <div ref={menuRef} className="row-menu" role="menu" style={{ top: place.top, bottom: place.bottom, right: place.right }}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`row-menu-item${item.danger ? ' danger' : ''}`}
              disabled={Boolean(item.disabledReason)}
              onClick={() => { setPlace(null); item.onSelect(); }}
            >
              {item.icon}
              <span>{item.label}{item.disabledReason && <small>{item.disabledReason}</small>}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
