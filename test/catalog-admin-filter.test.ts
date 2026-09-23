import assert from 'node:assert/strict';
import test from 'node:test';
import { firstUsefulTab, isLiveOnWebsite, splitCatalog } from '../lib/catalog-admin-filter';

const entry = (id: string, productId: string, status: string, title = id, partNumber = '') => ({
  id, erp_product_id: productId, title, part_number: partNumber, publication_status: status,
});

const ROWS = [
  entry('c1', 'p1', 'published', 'Hydraulic Pump', '20-900400'),
  entry('c2', 'p2', 'draft', 'stabilizer seal'),
  entry('c3', 'p3', 'needs_review', 'red gel greas 18 kg'),
  entry('c4', 'p4', 'unpublished', 'old kit'),
  entry('c5', 'p5', 'archived', 'retired part'),
];
const PRODUCTS = [
  { id: 'p1', name: 'Hydraulic Pump', part_number: '20-900400' },
  { id: 'p4', name: 'old kit', part_number: 'OLD-1' },
  { id: 'p6', name: 'CAB MOUNTING UPER N/M-JCB', part_number: '331/34392' },
  { id: 'p7', name: 'sun gear', part_number: '450-10210' },
];

test('only a published entry counts as live — exactly what the website shows', () => {
  assert.equal(isLiveOnWebsite({ publication_status: 'published' }), true);
  for (const status of ['draft', 'needs_review', 'unpublished', 'archived', '']) {
    assert.equal(isLiveOnWebsite({ publication_status: status }), false, status);
  }
});

test('every entry lands in exactly one of Live and Not live', () => {
  const { live, notLive } = splitCatalog(ROWS, PRODUCTS, '');
  assert.deepEqual(live.map((row) => row.id), ['c1']);
  assert.deepEqual(notLive.map((row) => row.id), ['c2', 'c3', 'c4', 'c5']);
});

test('a part with any entry, even one taken down, is not waiting to be added', () => {
  const { notAdded } = splitCatalog(ROWS, PRODUCTS, '');
  assert.deepEqual(notAdded.map((product) => product.id), ['p6', 'p7']);
});

test('one search narrows all three lists, by title and by part number without punctuation', () => {
  const byTitle = splitCatalog(ROWS, PRODUCTS, 'hydraulic');
  assert.deepEqual([byTitle.live.length, byTitle.notLive.length, byTitle.notAdded.length], [1, 0, 0]);
  const byNumber = splitCatalog(ROWS, PRODUCTS, '331-34392');
  assert.deepEqual(byNumber.notAdded.map((product) => product.id), ['p6']);
  assert.deepEqual(splitCatalog(ROWS, PRODUCTS, '20900400').live.map((row) => row.id), ['c1']);
});

test('the screen opens on the first list that has anything in it', () => {
  assert.equal(firstUsefulTab({ live: 16, 'not-live': 2, 'not-added': 235 }), 'live');
  assert.equal(firstUsefulTab({ live: 0, 'not-live': 2, 'not-added': 235 }), 'not-live');
  assert.equal(firstUsefulTab({ live: 0, 'not-live': 0, 'not-added': 0 }), 'not-added');
});
