import assert from 'node:assert/strict';
import test from 'node:test';
import { describeRow, money, pick } from '../lib/audit-log';

/** An entry has to read as a sentence about a part or a person, not about a row id — the owner is
 *  the one reading it, and a uuid tells them nothing about what was touched. */
test('a part is named by its part number and name together', () => {
  assert.equal(
    describeRow('products', { id: 'abc', part_number: '331/34392', name: 'oil filter' }),
    'the part 331/34392 oil filter'
  );
});

test('a part with no part number is still named', () => {
  assert.equal(describeRow('products', { id: 'abc', name: 'oil filter' }), 'the part oil filter');
});

test('a customer, a supplier and a company each read as themselves', () => {
  assert.equal(describeRow('customers', { id: 'c1', name: 'Teja' }), 'the customer Teja');
  assert.equal(describeRow('suppliers', { id: 's1', name: 'JAIN AUTO SALES' }), 'the supplier JAIN AUTO SALES');
  assert.equal(describeRow('companies', { id: 'x', name: 'Jai Durga Enterprises' }), 'the company Jai Durga Enterprises');
});

test('a staff account is named by its email, which is its identity here', () => {
  assert.equal(describeRow('users', { email: 'someone@example.com' }), 'the staff account someone@example.com');
});

/** Never an empty phrase: "Deleted " with nothing after it would read as though something
 *  anonymous had happened, which is worse than saying the id. */
test('a record with no usable name falls back to its id, never to nothing', () => {
  assert.equal(describeRow('products', { id: 'abc-123' }), 'the part abc-123');
  assert.equal(describeRow('products', {}), 'the part a record');
});

test('a table with no phrasing of its own still produces a sentence', () => {
  assert.equal(describeRow('grns', { id: 'GRN-1001' }), 'grns GRN-1001');
});

// ── Keeping an entry to what changed ─────────────────────────────────────────────────────────

test('only the fields that were written are kept', () => {
  const row = { id: 'p1', name: 'oil filter', cost_price: 100, sale_price: 150, brand: 'JCB' };
  assert.deepEqual(pick(row, ['cost_price', 'sale_price']), { cost_price: 100, sale_price: 150 });
});

test('a field the row does not have is left out rather than recorded as undefined', () => {
  assert.deepEqual(pick({ id: 'p1' }, ['cost_price']), {});
});

test('asking for nothing keeps nothing', () => {
  assert.deepEqual(pick({ id: 'p1', name: 'x' }, []), {});
});

// ── Amounts inside a sentence ────────────────────────────────────────────────────────────────

test('amounts are grouped the Indian way, as every screen shows them', () => {
  assert.equal(money(4318675), '₹43,18,675');
  assert.equal(money(43186.75), '₹43,186.75');
});

test('a missing or unreadable amount reads as zero rather than NaN', () => {
  assert.equal(money(0), '₹0');
  assert.equal(money(Number.NaN), '₹0');
});
