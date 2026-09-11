import assert from 'node:assert/strict';
import test from 'node:test';
import type { KeyboardEvent } from 'react';
import { isDeliberateSave, keepEnterInsideForm, SAVE_SHORTCUT_HINT } from '../lib/form-keys';

type Recorded = { prevented: boolean; submitted: boolean };

function press(
  key: string,
  tagName: string,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {},
  canSubmit = true
): Recorded {
  const recorded: Recorded = { prevented: false, submitted: false };
  const event = {
    key,
    ctrlKey: Boolean(modifiers.ctrlKey),
    metaKey: Boolean(modifiers.metaKey),
    target: { tagName },
    currentTarget: { requestSubmit: () => { recorded.submitted = true; } },
    preventDefault: () => { recorded.prevented = true; },
  } as unknown as KeyboardEvent<HTMLFormElement>;
  keepEnterInsideForm(event, canSubmit);
  return recorded;
}

test('Enter in a text input never submits the form', () => {
  // The whole point: a browser turns this into a click on the submit button, and on an entry
  // form that means saving a half-typed document.
  const result = press('Enter', 'INPUT');
  assert.equal(result.prevented, true);
  assert.equal(result.submitted, false);
});

test('a barcode scanner trailing Enter is swallowed', () => {
  // Scanners end every scan with one. This is the case that made it a certainty, not an accident.
  assert.deepEqual(press('Enter', 'INPUT'), { prevented: true, submitted: false });
});

test('Ctrl+Enter is the deliberate save', () => {
  const result = press('Enter', 'INPUT', { ctrlKey: true });
  assert.equal(result.submitted, true);
});

test('Cmd+Enter saves too', () => {
  assert.equal(press('Enter', 'INPUT', { metaKey: true }).submitted, true);
});

test('Ctrl+Enter cannot do what the disabled submit button would refuse', () => {
  // canSubmit mirrors the button's own disabled condition, so the shortcut is never a way round it.
  const result = press('Enter', 'INPUT', { ctrlKey: true }, false);
  assert.equal(result.submitted, false);
  assert.equal(result.prevented, true);
});

test('Enter on a focused button is left alone', () => {
  // Enter on a button is a click; taking that away would break Cancel and every stepper.
  assert.deepEqual(press('Enter', 'BUTTON'), { prevented: false, submitted: false });
});

test('Enter in a textarea still makes a newline', () => {
  assert.deepEqual(press('Enter', 'TEXTAREA'), { prevented: false, submitted: false });
});

test('every other key passes straight through', () => {
  for (const key of ['a', 'Tab', 'Escape', 'ArrowDown', ' ']) {
    assert.deepEqual(press(key, 'INPUT'), { prevented: false, submitted: false }, `failed for ${key}`);
  }
});

test('isDeliberateSave only agrees with a modified Enter', () => {
  const make = (key: string, ctrlKey = false) => ({ key, ctrlKey, metaKey: false }) as KeyboardEvent;
  assert.equal(isDeliberateSave(make('Enter', true)), true);
  assert.equal(isDeliberateSave(make('Enter')), false);
  assert.equal(isDeliberateSave(make('s', true)), false);
});

test('the hint names the shortcut it documents', () => {
  // If these drift, the form tells people to press something that does nothing.
  assert.match(SAVE_SHORTCUT_HINT, /Ctrl\+Enter/);
});
