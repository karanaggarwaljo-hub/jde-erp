import assert from 'node:assert/strict';
import test from 'node:test';
import { duplicateCreditNotes } from '../lib/sales-returns';

// The real rows, as they sit in the live data today.
const LIVE = [
  { id: 'SRN-1002', invoice_id: 'INV-1011', credit_total: '12000.00' },
  { id: 'SRN-1003', invoice_id: 'INV-1013', credit_total: '3500.00' },
  { id: 'SRN-1004', invoice_id: 'INV-1013', credit_total: '3500.00' },
  { id: 'SRN-1005', invoice_id: 'INV-1013', credit_total: '3500.00' },
];

test('the three identical credit notes on INV-1013 each name the other two', () => {
  for (const id of ['SRN-1003', 'SRN-1004', 'SRN-1005']) {
    const credit = LIVE.find((row) => row.id === id)!;
    const others = duplicateCreditNotes(credit, LIVE);
    assert.equal(others.length, 2, `${id} should see the other two`);
    assert.ok(!others.some((row) => row.id === id), 'never itself');
  }
});

test('a one-off credit note stays quiet', () => {
  const credit = LIVE.find((row) => row.id === 'SRN-1002')!;
  assert.deepEqual(duplicateCreditNotes(credit, LIVE), []);
});

test('the same amount against a different invoice is not a duplicate', () => {
  const rows = [
    { id: 'A', invoice_id: 'INV-1', credit_total: 3500 },
    { id: 'B', invoice_id: 'INV-2', credit_total: 3500 },
  ];
  assert.deepEqual(duplicateCreditNotes(rows[0], rows), []);
});

test('a different amount on the same invoice is not a duplicate', () => {
  // Two genuine partial returns off one invoice must not be accused of being one mis-click.
  const rows = [
    { id: 'A', invoice_id: 'INV-1', credit_total: 3500 },
    { id: 'B', invoice_id: 'INV-1', credit_total: 1200 },
  ];
  assert.deepEqual(duplicateCreditNotes(rows[0], rows), []);
});

test('an amount stored as a string matches the same amount as a number', () => {
  // Postgres hands numerics over as strings; "3500.00" and 3500 are one amount.
  const rows = [
    { id: 'A', invoice_id: 'INV-1', credit_total: '3500.00' },
    { id: 'B', invoice_id: 'INV-1', credit_total: 3500 },
  ];
  assert.equal(duplicateCreditNotes(rows[0], rows).length, 1);
});

test('an unreadable amount is treated as zero rather than matching everything', () => {
  const rows = [
    { id: 'A', invoice_id: 'INV-1', credit_total: 'n/a' },
    { id: 'B', invoice_id: 'INV-1', credit_total: 3500 },
  ];
  assert.deepEqual(duplicateCreditNotes(rows[0], rows), []);
});
