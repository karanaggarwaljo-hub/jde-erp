/**
 * Exercises the rules that decide whether an imported invoice line restocks a part you already
 * own or creates a new one — and what an invoice is allowed to fill in on an existing part.
 *
 *   npx tsx scripts/import-matching-check.ts
 *
 * No API keys, no database, no login: the logic in lib/import-matching.ts is pure, which is the
 * reason it lives there rather than inside the Purchases page. Getting this wrong costs real
 * money (stock and cost landing on the wrong part), so the cases below are deliberately the
 * awkward ones: same part named differently, placeholder part numbers, and near-miss names that
 * must NOT be linked automatically.
 */
import { matchImportedLine, planFieldUpdates, type MatchableProduct } from '../lib/import-matching';
import type { ImportedLine } from '../lib/client-import';

const product = (over: Partial<MatchableProduct>): MatchableProduct => ({
  id: over.id ?? 'p1',
  part_number: '',
  oem_number: '',
  hsn_code: '',
  brand: '',
  name: '',
  cost_price: 0,
  current_stock: 0,
  ...over,
});

const line = (over: Partial<ImportedLine>): ImportedLine => ({
  description: '',
  quantity: 1,
  unit_price: 100,
  ...over,
});

let passed = 0;
let failed = 0;

function check(label: string, actual: string, expected: string): void {
  if (actual === expected) {
    passed += 1;
    console.log(`PASS  ${label} → ${actual}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label} → got "${actual}", expected "${expected}"`);
  }
}

function describe(result: ReturnType<typeof matchImportedLine>): string {
  return result.kind === 'none' ? 'none' : `${result.kind}:${result.product.id}`;
}

// The owner's own scenario: a part already on file at zero stock, and an invoice that calls the
// same thing something else but prints the part number.
const oilFilter = product({ id: 'oil-filter', part_number: 'W940/25', name: 'Oil Filter Element', current_stock: 0 });

check(
  'same part, different name, part number printed',
  describe(matchImportedLine(line({ description: 'FILTER OIL SPIN ON', part_number: 'W 940/25' }), [oilFilter])),
  'exact:oil-filter'
);

check(
  'supplier prints the part number in the OEM column',
  describe(matchImportedLine(line({ description: 'FILTER OIL', oem_number: 'w94025' }), [oilFilter])),
  'exact:oil-filter'
);

check(
  'identifier beats a same-looking name on a different part',
  describe(matchImportedLine(
    line({ description: 'Oil Filter Element', part_number: 'XYZ-1' }),
    [oilFilter, product({ id: 'other', part_number: 'XYZ-1', name: 'Completely Different Thing' })]
  )),
  'exact:other'
);

// No identifier anywhere: similar wording may only ever be a suggestion, never an auto-link.
check(
  'no part number, similar name → suggestion only',
  describe(matchImportedLine(line({ description: 'Oil Filter Element JCB' }), [oilFilter])),
  'suggested:oil-filter'
);

check(
  'unrelated name → no match at all',
  describe(matchImportedLine(line({ description: 'Hydraulic Hose 2 metre' }), [oilFilter])),
  'none'
);

// A part number this app invented during an earlier import is not evidence of anything, so it
// must not produce a confident match. Falling through to a name suggestion is fine — that still
// puts the decision in front of the owner.
const placeholder = product({ id: 'placeholder', part_number: 'SP-014', name: 'Seal Kit' });
check(
  'an SP-### placeholder never counts as an identifier match',
  describe(matchImportedLine(line({ description: 'Seal kit assorted', part_number: 'SP-014' }), [placeholder])),
  'suggested:placeholder'
);
check(
  'and it does not match a differently-named part either',
  describe(matchImportedLine(line({ description: 'Hydraulic pump', part_number: 'SP-014' }), [placeholder])),
  'none'
);

// What an invoice may fill in, and what it may not touch.
const partial = product({ id: 'partial', part_number: 'SP-021', name: 'Brake Pad Set', brand: '', oem_number: '', cost_price: 0 });
const rich = line({ description: 'BRAKE PAD SET', part_number: 'BP-9100', oem_number: 'OE-55', brand: 'Bosch', hsn_code: '87083000', unit_price: 450 });
const plan = planFieldUpdates(rich, partial);

check('placeholder part number is replaced', String(plan.fills.part_number), 'BP-9100');
check('blank OEM number is filled', String(plan.fills.oem_number), 'OE-55');
check('blank brand is filled', String(plan.fills.brand), 'Bosch');
check('blank HSN is filled', String(plan.fills.hsn_code), '87083000');
check('zero cost is filled', String(plan.fills.cost_price), '450');
check('nothing is reported as a conflict', String(plan.conflicts.length), '0');

// The owner's own data always outranks the supplier's.
const owned = product({ id: 'owned', part_number: 'BP-9100', name: 'Brake Pad Set', brand: 'TVS', oem_number: 'OE-55', cost_price: 400 });
const conflicting = planFieldUpdates(line({ description: 'BRAKE PAD SET', brand: 'Bosch', oem_number: 'OE-55', unit_price: 450 }), owned);

check('an entered brand is never overwritten', String(conflicting.fills.brand ?? 'untouched'), 'untouched');
check('the disagreement is reported instead', String(conflicting.conflicts.length), '1');
check('an agreeing value raises no conflict', String(conflicting.conflicts.some((c) => c.startsWith('OEM'))), 'false');
check('an existing cost is not overwritten', String(conflicting.fills.cost_price ?? 'untouched'), 'untouched');

console.log(`\n${passed}/${passed + failed} checks passed.`);
process.exit(failed ? 1 : 0);
