import assert from 'node:assert/strict';
import test from 'node:test';
import { seal, unseal } from '../lib/drive/crypto';
import { buildAuthUrl, DRIVE_SCOPES, driveQuoted, emailFromIdToken, multipartBody } from '../lib/drive/google';
import { datedFolderPath, driveFileName, driveName, redirectUriFor } from '../lib/drive';
import { billExtension, isBillMimeType, isFileHash } from '../lib/purchase-bills';

const SERVER_KEY = 'test-service-role-key-not-a-real-one';

test('a Google key is stored sealed, and opens only with the same server key', () => {
  const sealed = seal('1//refresh-token-value', SERVER_KEY);
  assert.ok(sealed.startsWith('v1.'));
  assert.ok(!sealed.includes('refresh-token-value'));
  assert.equal(unseal(sealed, SERVER_KEY), '1//refresh-token-value');
  assert.equal(unseal(sealed, 'a-different-server-key'), null);
  assert.notEqual(seal('same', SERVER_KEY), seal('same', SERVER_KEY), 'a fresh nonce every time');
  const [v, iv, tag, body] = sealed.split('.');
  const tampered = [v, iv, tag, body.slice(0, -2) + (body.endsWith('A') ? 'BB' : 'AA')].join('.');
  assert.equal(unseal(tampered, SERVER_KEY), null);
  assert.equal(unseal('not sealed', SERVER_KEY), null);
});

test('the Google screen asks only for the ERP\'s own files, and always returns a lasting key', () => {
  const url = new URL(buildAuthUrl({ clientId: 'id.apps.googleusercontent.com', clientSecret: 'x' }, 'https://erp.example.com/api/drive/callback', 'nonce123'));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('scope'), DRIVE_SCOPES.join(' '));
  assert.ok(!url.searchParams.get('scope')!.includes('auth/drive '), 'never the whole-Drive scope');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('state'), 'nonce123');
  assert.equal(redirectUriFor('https://erp.example.com/'), 'https://erp.example.com/api/drive/callback');
});

test('the Google account is read from the id token', () => {
  const token = ['x', Buffer.from(JSON.stringify({ email: 'shop@gmail.com' })).toString('base64url'), 'sig'].join('.');
  assert.equal(emailFromIdToken(token), 'shop@gmail.com');
  assert.equal(emailFromIdToken(undefined), '');
  assert.equal(emailFromIdToken('garbage'), '');
});

test('one upload carries the file details and the bytes', () => {
  const body = Buffer.from(multipartBody({ name: 'PO-1.pdf', parents: ['f1'] }, 'application/pdf', new Uint8Array([37, 80, 68, 70]), 'B'));
  const text = body.toString('latin1');
  assert.ok(text.startsWith('--B\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"PO-1.pdf","parents":["f1"]}\r\n--B\r\nContent-Type: application/pdf\r\n\r\n%PDF'));
  assert.ok(text.endsWith('\r\n--B--\r\n'));
  assert.equal(driveQuoted("Sharma's"), "'Sharma\\'s'");
});

test('files land in year and month folders under readable names', () => {
  assert.deepEqual(datedFolderPath('Supplier bills', '2026-10-12'), ['Supplier bills', '2026', '10 October']);
  assert.deepEqual(datedFolderPath('Sales invoices', '2027-01-03'), ['Sales invoices', '2027', '01 January']);
  assert.equal(datedFolderPath('Supplier bills', null).length, 3);
  assert.equal(driveFileName(['PO-1023', 'Sharma Traders / Mohali', 'Bill 44:71', '2026-10-12'], 'jpg'), 'PO-1023 - Sharma Traders Mohali - Bill 44 71 - 2026-10-12.jpg');
  assert.equal(driveFileName([null, ''], 'pdf'), 'file.pdf');
  assert.equal(driveName(['JDE ERP', 'Jai Durga Enterprises']), 'JDE ERP - Jai Durga Enterprises');
});

test('only bill photos and PDFs are kept, under their own fingerprint', () => {
  assert.ok(isBillMimeType('image/jpeg'));
  assert.ok(isBillMimeType('application/pdf'));
  assert.ok(!isBillMimeType('text/html'));
  assert.equal(billExtension('image/webp'), 'webp');
  assert.ok(isFileHash('a'.repeat(64)));
  assert.ok(!isFileHash('../../etc/passwd'));
  assert.ok(!isFileHash('A'.repeat(64)), 'the browser writes lowercase hex');
});
