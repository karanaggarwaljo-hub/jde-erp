import assert from 'node:assert/strict';
import test from 'node:test';
import { entryLink, parseEntryIntent, withoutEntryIntent } from '../lib/entry-intent';

/** Each Day Book tile opens the form on the screen that owns that kind of entry. */
test('each kind of entry links to the screen that records it', () => {
  assert.equal(entryLink('sale'), '/sales?record=sale&back=daybook');
  assert.equal(entryLink('payment-in'), '/sales?record=payment&back=daybook');
  assert.equal(entryLink('purchase'), '/purchases?record=purchase&back=daybook');
  assert.equal(entryLink('supplier-payment'), '/suppliers?record=payment&back=daybook');
  assert.equal(entryLink('expense'), '/expenses?record=expense&back=daybook');
});

/** Home's big buttons open the same forms and bring the owner back to Home once they are saved. */
test('an entry started from Home returns to Home', () => {
  assert.equal(entryLink('sale', 'home'), '/sales?record=sale&back=home');
  assert.deepEqual(
    parseEntryIntent('?record=expense&back=home', ['expense'] as const),
    { record: 'expense', returnTo: '/dashboard' }
  );
});

/** The Cheques page's "Cheque received" opens Money received and comes back to Cheques. */
test('an entry started from the Cheques page returns there', () => {
  assert.equal(entryLink('payment-in', 'cheques'), '/sales?record=payment&back=cheques');
  assert.equal(parseEntryIntent('?record=payment&back=cheques', ['payment'] as const).returnTo, '/cheques');
});

test('a screen reads the form it was asked to open and where to return', () => {
  assert.deepEqual(
    parseEntryIntent('?record=sale&back=daybook', ['sale', 'payment'] as const),
    { record: 'sale', returnTo: '/daybook' }
  );
});

test('it reads the same from a URLSearchParams as from a string', () => {
  assert.deepEqual(
    parseEntryIntent(new URLSearchParams('record=payment&back=daybook'), ['sale', 'payment'] as const),
    { record: 'payment', returnTo: '/daybook' }
  );
});

test('a form this screen does not have is ignored rather than guessed at', () => {
  assert.equal(parseEntryIntent('?record=expense', ['sale', 'payment'] as const).record, null);
});

test('an ordinary visit with nothing in the address opens nothing and returns nowhere', () => {
  assert.deepEqual(parseEntryIntent('', ['sale'] as const), { record: null, returnTo: null });
});

/** The return address is looked up from a fixed list, never taken from the link itself. */
test('a link cannot send someone to another site after they save', () => {
  assert.equal(parseEntryIntent('?record=sale&back=https://example.com', ['sale'] as const).returnTo, null);
  assert.equal(parseEntryIntent('?record=sale&back=//example.com', ['sale'] as const).returnTo, null);
  assert.equal(parseEntryIntent('?record=sale&back=/settings', ['sale'] as const).returnTo, null);
});

test('names inherited by every object are not treated as return places', () => {
  assert.equal(parseEntryIntent('?back=__proto__', ['sale'] as const).returnTo, null);
  assert.equal(parseEntryIntent('?back=constructor', ['sale'] as const).returnTo, null);
});

/** So a refresh does not open the form a second time. */
test('the request is cleared from the address, keeping anything else in it', () => {
  assert.equal(withoutEntryIntent('/sales', '?record=sale&back=daybook'), '/sales');
  assert.equal(withoutEntryIntent('/sales', '?tab=quotes&record=sale&back=daybook'), '/sales?tab=quotes');
  assert.equal(withoutEntryIntent('/sales', ''), '/sales');
});
