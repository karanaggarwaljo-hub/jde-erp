import assert from 'node:assert/strict';
import test from 'node:test';
import { deviceLabel } from '../lib/device-label';
import { actionLabel, kindOf, LOG_KINDS, logBookCsv, searchTerm, shopDay, shopDayBounds, shopDayHeading, shopTime, type LogRow } from '../lib/logbook';

test('the devices the shop actually uses read in plain words', () => {
  assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'), 'Chrome on Windows');
  assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'), 'Chrome on Android phone');
  assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1'), 'Safari on iPhone');
  assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0'), 'Edge on Windows');
  assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36'), 'Samsung Internet on Android phone');
  assert.equal(deviceLabel(''), '');
  assert.equal(deviceLabel(null), '');
});

test('every entry the ERP writes lands in a kind, and reads as words', () => {
  for (const action of ['invoice.create', 'payment.receive', 'purchase.create', 'supplier.payment', 'products.edit', 'expense.create',
    'bill.scan', 'bill.drive', 'invoice_pdf.open', 'drive.connect', 'catalog_products.edit', 'auth.signin', 'users.invite', 'company.start_fresh', 'backup.auto']) {
    assert.ok(kindOf(action), `${action} has no kind`);
  }
  assert.equal(actionLabel('invoice.create'), 'Bill added');
  assert.equal(actionLabel('auth.signin_failed'), 'Sign-in wrong password');
  assert.equal(actionLabel('bill.drive'), 'Supplier bill saved to Drive');
  assert.equal(actionLabel('invoice.writeOff'), 'Bill settled');
  assert.equal(actionLabel('mystery.thing_done'), 'Mystery thing done', 'an unknown pair still reads');
  // No subject in two kinds, or the filters would overlap.
  const subjects = LOG_KINDS.flatMap((kind) => kind.subjects);
  assert.equal(new Set(subjects).size, subjects.length);
});

test('times and days are India time, whatever zone the device is in', () => {
  // 18:40 UTC is 00:10 the next morning in India.
  assert.equal(shopDay('2026-10-11T18:40:00Z'), '2026-10-12');
  assert.match(shopTime('2026-10-11T18:40:05Z'), /^12:10:05\s?am$/i);
  assert.equal(shopDayHeading('2026-10-12', '2026-10-12').startsWith('Today'), true);
  assert.equal(shopDayHeading('2026-10-11', '2026-10-12').startsWith('Yesterday'), true);
  const { start, end } = shopDayBounds('2026-10-12', '2026-10-12');
  assert.equal(start, '2026-10-11T18:30:00.000Z');
  assert.equal(end, '2026-10-12T18:29:59.999Z');
  assert.deepEqual(shopDayBounds('12/10/2026', null), { start: null, end: null });
});

test('a search cannot reach the database as filter syntax', () => {
  assert.equal(searchTerm('INV-1017'), 'INV-1017');
  assert.equal(searchTerm('a,b),summary.ilike.*%'), 'a b summary.ilike.');
  assert.equal(searchTerm(null), '');
});

test('the download opens in Excel with the right letters, and no cell runs as a formula', () => {
  const row: LogRow = {
    id: '1', at: '2026-10-12T04:30:00Z', actor_email: 'owner@example.com', actor_name: 'Karan', action: 'invoice.create',
    entity: 'invoices', entity_id: 'INV-1018', summary: 'Created INV-1018 for "Sharma, Ram" at ₹1,180', details: null, device: 'Chrome on Windows', company_id: 'c',
  };
  const csv = logBookCsv([row, { ...row, id: '2', summary: '=HYPERLINK("x")' }]);
  assert.ok(csv.startsWith('﻿Date,Time,Who'));
  assert.ok(csv.includes('2026-10-12,'));
  assert.ok(csv.includes('"Created INV-1018 for ""Sharma, Ram"" at ₹1,180"'));
  assert.ok(csv.includes(`'=HYPERLINK`), 'a leading = is defused');
});
