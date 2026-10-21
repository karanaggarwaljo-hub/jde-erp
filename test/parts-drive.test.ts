import assert from 'node:assert/strict';
import test from 'node:test';
import { partsCsv, photoFileName } from '../lib/parts-drive';

test('the parts list has one row per part, sorted, with its photo link and codes kept as typed', () => {
  const csv = partsCsv([
    { id: 'b', part_number: '911-12400', name: 'bkt main pin', brand: 'JCB', compatibility: 'JCB 3DX, 3D', sale_price: 950, current_stock: 4 },
    { id: 'a', part_number: '000123', name: 'Seal "big"', hsn_code: '84314930', oem_number: '1234567890123456' },
  ], new Map([['b', 'https://drive.google.com/file/d/x/view']]));
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Part number,OEM number,Name,Brand,Category,Fits,Sale price,MRP,Cost price,Stock,Min stock,Location,HSN,Photo');
  // Leading zeros and a 16-digit OEM number survive Google turning the CSV into a Sheet.
  assert.equal(lines[1], '"=""000123""","=""1234567890123456""","Seal ""big""",,,,,,,,,,84314930,');
  assert.equal(lines[2], '911-12400,,bkt main pin,JCB,,"JCB 3DX, 3D",950,,,4,,,,https://drive.google.com/file/d/x/view');
});

test('a photo is named by part number and name, readable in the Drive app', () => {
  assert.equal(photoFileName({ id: 'x', part_number: '911-12400', name: 'bkt main pin' }, 'image/jpeg'), '911-12400 - bkt main pin.jpg');
  assert.equal(photoFileName({ id: 'x', part_number: 'A/B', name: 'pin' }, 'image/webp'), 'A B - pin.webp');
  assert.equal(photoFileName({ id: 'x9', name: '' }, 'image/png'), 'x9.png');
});
