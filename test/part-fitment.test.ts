import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanFitment, listingFitment } from '../lib/part-fitment';

test('a listing with no fitment of its own takes the part\'s new one', () => {
  assert.equal(listingFitment('', '', 'JCB 3DX'), 'follow');
  assert.equal(listingFitment(null, 'JCB 3D', 'JCB 3DX'), 'follow');
});

test('a listing still showing the part\'s old fitment follows the change', () => {
  assert.equal(listingFitment('JCB 3D', 'JCB 3D', 'JCB 3D, JCB 3DX'), 'follow');
  assert.equal(listingFitment('jcb  3d', 'JCB 3D', 'JCB 3DX'), 'follow', 'spacing and capitals are not a different wording');
});

/** Someone wrote this on the catalog page on purpose; editing the part must not overwrite it. */
test('a listing with its own wording is left alone', () => {
  assert.equal(listingFitment('Fits JCB 3DX Super and 3DX Eco', 'JCB 3DX', 'JCB 3DX, JCB 4DX'), 'keep');
});

test('a listing that already says the new fitment needs nothing', () => {
  assert.equal(listingFitment('JCB 3DX', 'JCB 3D', 'JCB 3DX'), 'already-same');
});

test('what is typed is tidied, and anything that is not text is nothing', () => {
  assert.equal(cleanFitment('  JCB 3DX,   JCB N/M (bs4)  '), 'JCB 3DX, JCB N/M (bs4)');
  assert.equal(cleanFitment(42), '');
  assert.equal(cleanFitment('x'.repeat(400)).length, 300);
});
