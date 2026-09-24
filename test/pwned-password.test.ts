import assert from 'node:assert/strict';
import test from 'node:test';
import { appearsInRange, isLeakedPassword } from '../lib/pwned-password';

// SHA-1("password") = 5BAA6 1E4C9B93F3F0682250B6CF8331B7EE68FD8
const PREFIX = '5BAA6';
const SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';

function fakeList(body: string, status = 200) {
  const asked: string[] = [];
  const bodies: unknown[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    asked.push(String(url));
    bodies.push(init?.body);
    return new Response(body, { status });
  }) as typeof fetch;
  return { impl, asked, bodies };
}

test('a password on the leaked list is caught', async () => {
  const { impl } = fakeList(`0018A45C4D1DEF81644B54AB7F969B88D65:3\r\n${SUFFIX}:10434004\r\n`);
  assert.equal(await isLeakedPassword('password', impl), true);
});

/** Only the first five characters of the hash leave the server — never the password. */
test('only the start of the hash is sent, never the password', async () => {
  const { impl, asked, bodies } = fakeList('');
  await isLeakedPassword('password', impl);
  // The whole address, exactly: the service's own name, then the five-character prefix and nothing else.
  assert.deepEqual(asked, [`https://api.pwnedpasswords.com/range/${PREFIX}`]);
  assert.deepEqual(bodies, [undefined]);
});

test('a password not on the list is let through', async () => {
  const { impl } = fakeList('0018A45C4D1DEF81644B54AB7F969B88D65:3\n');
  assert.equal(await isLeakedPassword('password', impl), false);
});

/** Padding lines are fillers the list adds on request, marked with a count of 0. */
test('a padding line with a count of 0 is not a leak', () => {
  assert.equal(appearsInRange(`${SUFFIX}:0\n`, SUFFIX), false);
  assert.equal(appearsInRange(`${SUFFIX.toLowerCase()}:2\n`, SUFFIX), true);
});

/** Someone else's outage must never stop the owner setting a password. */
test('when the list cannot be reached, the answer is unknown rather than a refusal', async () => {
  const down = (async () => { throw new Error('network down'); }) as typeof fetch;
  assert.equal(await isLeakedPassword('password', down), null);
  const { impl } = fakeList('busy', 503);
  assert.equal(await isLeakedPassword('password', impl), null);
});
