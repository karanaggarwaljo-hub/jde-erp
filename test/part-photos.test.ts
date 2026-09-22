import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogPhotoIndex, ownPhotoPath, partPhotoPath, photoOf } from '../lib/part-photos';

const BASE = 'https://jjvoccqrsmsrrcqfxdjc.supabase.co/storage/v1/object/public/jde-catalog-images/';

const published = (productId: string, url: string, updated = '2026-09-01') => ({
  erp_product_id: productId, image_url: url, image_status: 'ready', publication_status: 'published', updated_at: updated,
});

test('the owner’s own photo wins over the catalog picture', () => {
  const catalog = catalogPhotoIndex([published('pin', BASE + 'cat-pin.jpg')]);
  assert.deepEqual(photoOf({ id: 'pin', image_url: BASE + 'part-photos/c/pin-1.jpg' }, catalog), {
    url: BASE + 'part-photos/c/pin-1.jpg', source: 'own',
  });
});

test('a published catalog picture fills in when the part has no photo of its own', () => {
  const catalog = catalogPhotoIndex([published('pin', BASE + 'cat-pin.jpg')]);
  assert.deepEqual(photoOf({ id: 'pin', image_url: null }, catalog), { url: BASE + 'cat-pin.jpg', source: 'catalog' });
});

test('a catalog picture the owner never published is not shown as the part', () => {
  const catalog = catalogPhotoIndex([
    { ...published('seal', BASE + 'seal.jpg'), publication_status: 'draft' },
    { ...published('grease', BASE + 'grease.jpg'), image_status: 'generating' },
    { ...published('oil', ''), image_status: 'ready' },
  ]);
  assert.equal(catalog.size, 0);
  assert.equal(photoOf({ id: 'seal' }, catalog), null);
});

test('no photo anywhere is no photo, not a placeholder URL', () => {
  assert.equal(photoOf({ id: 'tyre', image_url: '  ' }, new Map()), null);
});

test('when one part has two catalog pictures, the newest wins', () => {
  const catalog = catalogPhotoIndex([
    published('kit', BASE + 'old.jpg', '2026-08-01'),
    published('kit', BASE + 'new.jpg', '2026-09-10'),
  ]);
  assert.equal(catalog.get('kit'), BASE + 'new.jpg');
});

test('each upload gets its own safe name inside the part-photos folder', () => {
  assert.equal(partPhotoPath('6d0e-39', 'abc/../x', 'image/jpeg', 42), 'part-photos/6d0e-39/abcx-42.jpg');
  assert.equal(partPhotoPath('c', 'p', 'image/webp', 1), 'part-photos/c/p-1.webp');
});

test('only a part photo’s own file is ever tidied up, never a catalog picture', () => {
  assert.equal(ownPhotoPath(BASE + 'part-photos/c/p-1.jpg?v=2'), 'part-photos/c/p-1.jpg');
  assert.equal(ownPhotoPath(BASE + 'eb16179b.jpg'), null);
  assert.equal(ownPhotoPath(null), null);
});
