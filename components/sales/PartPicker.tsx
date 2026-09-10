'use client';

/**
 * The one box a sale is typed into.
 *
 * Replaces a native <datalist>, which only matched the full label character for character — so a
 * part number alone found nothing and a barcode scanner found nothing. The whole point of this
 * control is that a sale can be billed without touching the mouse: type or scan, Enter, type or
 * scan, Enter. Focus never leaves this box, so the next part can start being typed immediately.
 *
 * Enter resolves in the order someone would expect:
 *   1. whatever is highlighted in the list, if the list is open
 *   2. otherwise a part number that matches exactly and unambiguously — this is the barcode path,
 *      because a scanner types the code and sends Enter faster than any list can settle
 *   3. otherwise the single result, if there is only one
 * Nothing is picked on an ambiguous Enter. Billing whichever part happened to sort first is the
 * kind of mistake that reaches a customer.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, Plus, AlertTriangle } from 'lucide-react';
import { money } from '@/lib/money';
import { isAmbiguousCode, searchParts, scannedPart } from '@/lib/part-search';
import type { LastSold } from '@/lib/sale-entry';
import type { PartOption } from '@/lib/sales-types';

export type PartPickerProps = {
  parts: PartOption[];
  onPick: (part: PartOption) => void;
  /** Billing something that is not in the catalogue. Omitted hides the option entirely. */
  onCustom?: (description: string) => void;
  /** What this customer last paid, keyed by part label — shown on the row being considered. */
  lastSold?: Map<string, LastSold>;
  disabled?: boolean;
  /** Set by the form after a save so the box takes focus again for the next sale. */
  autoFocus?: boolean;
};

const MAX_RESULTS = 8;

export default function PartPicker({ parts, onPick, onCustom, lastSold, disabled, autoFocus }: PartPickerProps) {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [open, setOpen] = useState(false);
  // Whether the person has actually pointed at a row, with the arrow keys or the mouse. Only
  // then may Enter resolve a part number that several products share.
  const [chose, setChose] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const matches = useMemo(() => searchParts(query, parts, MAX_RESULTS), [query, parts]);

  // Clamped on read rather than corrected from an effect. The list can shrink out from under the
  // highlight whenever the query or the catalogue changes, and fixing that in an effect would
  // leave one render in which Enter pointed at a row that is no longer on screen.
  const active = matches.length > 0 ? Math.min(highlight, matches.length - 1) : 0;

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const pick = (part: PartOption) => {
    onPick(part);
    setQuery('');
    setOpen(false);
    setChose(false);
    // Straight back to an empty box, still focused, ready for the next part.
    inputRef.current?.focus();
  };

  const commit = () => {
    // A part number several products share must never be resolved by a keystroke. SP-258 is on
    // three different products in the live catalogue, and a scan followed by Enter would other-
    // wise bill whichever happened to sort first. The list stays open and waits for a real
    // choice — made with the arrow keys or the mouse, which is what `chose` records.
    if (!chose && isAmbiguousCode(query, parts)) {
      setOpen(true);
      return;
    }
    if (open && matches[active]) return pick(matches[active].part);
    const scanned = scannedPart(query, parts);
    if (scanned) return pick(scanned);
    if (matches.length === 1) return pick(matches[0].part);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // This control lives inside the invoice <form>. Enter here must never reach the form and
    // submit the invoice — which is what a barcode scanner used to do, saving a half-typed sale.
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setChose(true);
      setHighlight(matches.length === 0 ? 0 : (active + 1) % matches.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setChose(true);
      setHighlight(matches.length === 0 ? 0 : (active - 1 + matches.length) % matches.length);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (open) setOpen(false);
      else setQuery('');
    }
  };

  const showList = open && query.trim().length > 0;
  const nothingFound = showList && matches.length === 0;

  return (
    <div className="part-picker">
      <div className="part-picker-field">
        <Search size={15} aria-hidden="true" className="text-muted" />
        <input
          ref={inputRef}
          type="text"
          className="form-input"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && matches[active] ? `${listId}-${active}` : undefined}
          placeholder="Scan a barcode, or type a part number or name…"
          autoComplete="off"
          disabled={disabled}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setHighlight(0); setChose(false); setOpen(true); }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          // A click on a result would otherwise be lost to the blur that closes the list first.
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        />
      </div>

      {showList && (
        <ul className="part-picker-list" id={listId} role="listbox" aria-label="Matching parts">
          {matches.map((match, index) => {
            const part = match.part;
            const previous = lastSold?.get(part.value);
            const outOfStock = part.stock <= 0;
            return (
              <li
                key={part.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={'part-picker-option' + (index === active ? ' is-active' : '')}
                onMouseEnter={() => { setHighlight(index); setChose(true); }}
                onMouseDown={(event) => { event.preventDefault(); pick(part); }}
              >
                <div className="part-picker-main">
                  <span className="pn-chip">{part.partNumber}</span>
                  <span className="part-picker-name">{part.name}</span>
                  {part.brand && <span className="text-muted text-sm">{part.brand}</span>}
                </div>
                <div className="part-picker-meta">
                  <span className={outOfStock ? 'text-danger text-sm' : 'text-muted text-sm'}>
                    {outOfStock ? 'none on shelf' : `${part.stock} in stock`}
                  </span>
                  <strong>₹{money(part.price)}</strong>
                  {/* Only ever the rate on a real past invoice to this same customer. */}
                  {previous && (
                    <span className="text-muted text-sm">last: ₹{money(previous.rate)}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {nothingFound && (
        <div className="part-picker-list part-picker-empty">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-muted" aria-hidden="true" />
            <span className="text-muted text-sm">Nothing in Inventory matches “{query.trim()}”.</span>
          </div>
          {onCustom && (
            <button
              type="button"
              className="btn btn-secondary btn-sm mt-2"
              onMouseDown={(event) => {
                event.preventDefault();
                onCustom(query.trim());
                setQuery('');
                setOpen(false);
                inputRef.current?.focus();
              }}
            ><Plus size={13} /> Bill it as a one-off line</button>
          )}
        </div>
      )}
    </div>
  );
}
