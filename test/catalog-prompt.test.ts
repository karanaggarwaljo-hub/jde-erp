import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogImagePrompt } from '../lib/catalogPrompt';

test('catalog image prompt locks the product while varying the catalogue background', () => {
  const prompt = buildCatalogImagePrompt({
    name: 'Hydraulic Pump',
    part_number: 'HP-100',
    oem_number: '',
    brand: 'Parker',
    category: 'Hydraulics',
    compatibility: 'JCB 3DX',
  });

  assert.match(prompt, /REFERENCE LOCK/);
  assert.match(prompt, /exact shape, proportions, colour/);
  assert.match(prompt, /fresh variation of the Jai Durga catalogue setting/);
  assert.match(prompt, /Vary the workshop layout/);
  assert.match(prompt, /must not duplicate an earlier composition/);
  assert.match(prompt, /16:9 landscape/);
  assert.doesNotMatch(prompt, /generic replacement part/);
  assert.match(prompt, /Hydraulic Pump/);
  assert.match(prompt, /Parker/);
});
