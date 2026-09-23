import assert from 'node:assert/strict';
import test from 'node:test';
import { navHiddenOnServer, readNavHidden, subscribeNavHidden, writeNavHidden } from '../lib/nav-hidden';

function fakeStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

/** A browser set to block site data throws on the storage property itself. */
const throwingStore = {
  getItem() { throw new Error('site data blocked'); },
  setItem() { throw new Error('site data blocked'); },
};

test('a browser that has never hidden the menu gets the menu', () => {
  assert.equal(readNavHidden(fakeStore()), false);
  assert.equal(readNavHidden(null), false);
});

test('hiding the menu is remembered, and showing it again is too', () => {
  const store = fakeStore();
  writeNavHidden(true, store);
  assert.equal(readNavHidden(store), true);
  writeNavHidden(false, store);
  assert.equal(readNavHidden(store), false);
});

test('anything else in storage means the menu is shown, never half-hidden', () => {
  assert.equal(readNavHidden(fakeStore({ 'jde.nav-hidden': 'yes' })), false);
});

/** The menu must still work in a browser that refuses to remember anything. */
test('a browser that blocks site data neither throws nor hides the menu', () => {
  assert.equal(readNavHidden(throwingStore), false);
  assert.doesNotThrow(() => writeNavHidden(true, throwingStore));
});

test('the chrome is told when the menu is hidden, and stops being told once it lets go', () => {
  let told = 0;
  const unsubscribe = subscribeNavHidden(() => { told += 1; });
  writeNavHidden(true, fakeStore());
  assert.equal(told, 1);
  unsubscribe();
  writeNavHidden(false, fakeStore());
  assert.equal(told, 1);
});

test('the server always says shown, so the first page matches what React draws', () => {
  assert.equal(navHiddenOnServer(), false);
});
