/**
 * What Enter does inside a document-entry form.
 *
 * A browser turns Enter in any text input into a click on the form's submit button. On a login
 * box that is exactly right. On a form that records a sale, a purchase, an expense or a part it
 * is a way to save a half-typed document by accident — and a barcode scanner ends every scan with
 * an Enter, so on the two screens that accept scans it was not a rare accident but the normal
 * consequence of scanning.
 *
 * The rule everywhere a document is keyed:
 *
 *   Enter          does nothing to the form. On the part picker it adds a part; elsewhere it is
 *                  simply swallowed, so a stray one cannot save anything.
 *   Ctrl+Enter     saves, deliberately. requestSubmit is used rather than calling the handler,
 *                  so the browser runs the same required-field validation the button does.
 *   Enter on a
 *   button, or in
 *   a textarea     left alone. Enter on a focused button is a click, and inside a textarea it is
 *                  a newline; taking either away would break something that works.
 *
 * Small dialogs that ask one question — a login, a password reset, the public enquiry form — keep
 * the browser's default, because there Enter meaning "done" is the whole convenience.
 */

import type { KeyboardEvent } from 'react';

/** True when this keypress is the deliberate save rather than an ordinary Enter. */
export function isDeliberateSave(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && (event.ctrlKey || event.metaKey);
}

/**
 * Wire as `onKeyDown` on a document-entry `<form>`.
 *
 * `canSubmit` should be the same condition the submit button is disabled by, so Ctrl+Enter can
 * never do what the button would refuse to do. Defaults to true for a form whose button has no
 * condition beyond the browser's own validation.
 */
export function keepEnterInsideForm(event: KeyboardEvent<HTMLFormElement>, canSubmit = true): void {
  if (event.key !== 'Enter') return;

  const target = event.target as HTMLElement;
  if (target.tagName === 'BUTTON' || target.tagName === 'TEXTAREA') return;

  event.preventDefault();
  if ((event.ctrlKey || event.metaKey) && canSubmit) event.currentTarget.requestSubmit();
}

/** The hint shown on these forms, in one place so every screen says the same thing. */
export const SAVE_SHORTCUT_HINT = 'Ctrl+Enter saves';
