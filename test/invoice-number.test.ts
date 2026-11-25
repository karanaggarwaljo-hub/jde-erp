/** The optional typed bill number (lib/invoice-number.ts). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanInvoiceNumber, invoiceNumberProblem } from '../lib/invoice-number';

test('blank means automatic; a typed number is trimmed and put in capitals', () => {
  assert.equal(invoiceNumberProblem(''), null);
  assert.equal(invoiceNumberProblem('   '), null);
  assert.equal(invoiceNumberProblem(undefined), null);
  assert.equal(cleanInvoiceNumber('  jde/25-26/001 '), 'JDE/25-26/001');
});

test('GST rules: up to 16 letters, numbers, - and /, with a number in it', () => {
  for (const ok of ['INV-2000', 'JDE/25-26/001', '501', 'A1']) assert.equal(invoiceNumberProblem(ok), null, ok);
  assert.match(invoiceNumberProblem('JDE/2025-2026/0001')!, /at most 16/);
  assert.match(invoiceNumberProblem('INV 2000')!, /only letters, numbers/);
  assert.match(invoiceNumberProblem('INV_2000')!, /only letters, numbers/);
  assert.match(invoiceNumberProblem('ABC')!, /at least one number/);
});

test('a number already on a bill is refused, whatever its capitals', () => {
  assert.match(invoiceNumberProblem('inv-1024', ['INV-1023', 'INV-1024'])!, /INV-1024 is already used/);
  assert.equal(invoiceNumberProblem('INV-1025', ['INV-1023', 'INV-1024']), null);
});
