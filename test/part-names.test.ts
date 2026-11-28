/** Finding a part by what the customer calls it (lib/part-names.ts, lib/part-search.ts). The part
 *  names below are real ones from the shop's Stock list, spelled as they are kept. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { alreadyNamed, cleanOtherNames, looseMatch, splitNameList } from '../lib/part-names';
import { searchParts, type SearchablePart } from '../lib/part-search';
import { matchesProductSearch, searchProducts } from '../lib/product-search';

const part = (name: string, extra: Partial<SearchablePart> = {}): SearchablePart => ({ value: name, partNumber: '', name, brand: '', stock: 1, ...extra });
const STOCK = [
  part('STEARING COUPLING 3DX'), part('big pinion beraing 803149/10'), part('36 teeth grari'), part('rase wire assy complete'),
  part('silancer spring'), part('kpc plate bolt'), part('jcb Altinator'), part('Loader Tooth kit'), part('shaft bearing 6007'),
  part('nylon pad (tikki)'), part('Hydraulic Pump'), part('gn u/j spider kit (cross)'), part('stab adjuster nut'), part('seat cover'),
];
const first = (query: string) => searchParts(query, STOCK)[0]?.part.name;

test('a slip of spelling still finds the part', () => {
  assert.equal(first('steering coupling'), 'STEARING COUPLING 3DX');
  assert.equal(first('bearing pinion'), 'big pinion beraing 803149/10');
  assert.equal(first('hydrolic pump'), 'Hydraulic Pump');
});

test('shop words find the part under its listed name, and say how', () => {
  const gear = searchParts('gear 36', STOCK)[0];
  assert.equal(gear.part.name, '36 teeth grari');
  assert.equal(gear.why, 'similar');
  assert.equal(gear.via, 'gear = grari');
  assert.equal(first('accelerator cable'), 'rase wire assy complete');
  assert.equal(first('kamani silencer'), 'silancer spring');
  assert.equal(first('alternator'), 'jcb Altinator');
  assert.ok(searchParts('daant', STOCK).some((match) => match.part.name === 'Loader Tooth kit'));
  assert.equal(first('tiki'), 'nylon pad (tikki)');
  assert.equal(first('cross kit'), 'gn u/j spider kit (cross)');
  assert.equal(first('stabilizer nut'), 'stab adjuster nut');
});

test('a long name and its short form find each other', () => {
  assert.equal(first('king pin carrier bolt'), 'kpc plate bolt');
  assert.equal(first('kpc'), 'kpc plate bolt');
});

test('numbers and short words are never stretched', () => {
  assert.equal(searchParts('6008 bearing', STOCK).length, 0, '6008 is not the 6007 bearing');
  assert.ok(!searchParts('seal', STOCK).some((match) => match.part.name === 'seat cover'), 'seal is not seat');
});

test('what customers call a part finds it, ahead of a near spelling', () => {
  const withNames = [...STOCK, part('Water Separator', { otherNames: ['diesel jali', 'paani filter'] })];
  const found = searchParts('paani', withNames)[0];
  assert.equal(found.part.name, 'Water Separator');
  assert.equal(found.why, 'other-name-prefix');
  assert.equal(found.via, 'paani filter');
  const plainFirst = searchParts('pinion', [...STOCK, part('pinion seal')]);
  assert.equal(plainFirst[0].part.name, 'pinion seal', 'a name that starts with the word comes first');
});

test('Stock\'s search: exact matches when there are any, close ones only when there are none', () => {
  const rows = [{ name: 'STEARING COUPLING 3DX' }, { name: 'steering pump' }, { name: 'Water Separator', other_names: ['paani filter'] }];
  assert.ok(matchesProductSearch(rows[2], 'paani'));
  assert.deepEqual(searchProducts(rows, 'stearing').rows.map((row) => row.name), ['STEARING COUPLING 3DX']);
  const loose = searchProducts(rows, 'stering');
  assert.equal(loose.loose, true);
  assert.deepEqual(loose.rows.map((row) => row.name), ['STEARING COUPLING 3DX', 'steering pump']);
  assert.equal(searchProducts(rows, 'zzzz').rows.length, 0);
});

test('other names are tidied, and a word already on the part is not offered again', () => {
  assert.deepEqual(cleanOtherNames(['  grari ', 'Grari', '36 teeth grari', '', 'gear  wheel'], '36 teeth grari'), ['grari', 'gear wheel']);
  assert.deepEqual(splitNameList('grari, gear wheel; kamani'), ['grari', 'gear wheel', 'kamani']);
  assert.equal(alreadyNamed('grari', '36 teeth grari'), true);
  assert.equal(alreadyNamed('gear', '36 teeth grari'), false);
  assert.equal(alreadyNamed('paani filter', 'Water Separator', ['Paani Filter']), true);
  assert.equal(looseMatch('pump', ['Hydraulic Pump']), null, 'a plain match needs no help');
});
