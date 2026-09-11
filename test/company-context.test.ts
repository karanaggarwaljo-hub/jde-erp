import assert from 'node:assert/strict';
import test from 'node:test';
import { filterCompaniesOpenTo, pickCompanyId } from '../lib/company-context';

/** This decides whose books a saved invoice lands in, which is why it is tested on its own. */
test('a person works in the company they chose', () => {
  assert.equal(
    pickCompanyId({ chosen: 'B', chosenAllowed: true, userCompanyId: 'A', installationDefault: 'C' }),
    'B'
  );
});

/** A cookie is a preference, never a key. Someone who edits theirs to another company's id gets
 *  their own company back, not that one. */
test('a choice they may not open is ignored, not obeyed', () => {
  assert.equal(
    pickCompanyId({ chosen: 'B', chosenAllowed: false, userCompanyId: 'A', installationDefault: 'C' }),
    'A'
  );
});

test('someone who has never chosen works in their own company', () => {
  assert.equal(pickCompanyId({ chosenAllowed: false, userCompanyId: 'A', installationDefault: 'C' }), 'A');
});

/** The nightly backup and the cron job have no session and no cookie at all. */
test('a job with no session falls back to the installation default', () => {
  assert.equal(pickCompanyId({ chosenAllowed: false, installationDefault: 'C' }), 'C');
});

test('an owner with no company of their own still gets the default', () => {
  assert.equal(pickCompanyId({ chosenAllowed: false, userCompanyId: null, installationDefault: 'C' }), 'C');
});

test('nothing to fall back on answers nothing, rather than a wrong company', () => {
  assert.equal(pickCompanyId({ chosenAllowed: false }), undefined);
});

test('an empty cookie is not a choice', () => {
  assert.equal(pickCompanyId({ chosen: '', chosenAllowed: true, userCompanyId: 'A' }), 'A');
});

// ── Which companies the switcher may offer ───────────────────────────────────────────────────

const COMPANIES = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];

test('an owner may switch between every company', () => {
  assert.deepEqual(filterCompaniesOpenTo(COMPANIES, { role: 'owner', company_id: 'A' }), COMPANIES);
});

/** The switcher must never offer a company the next request would refuse. */
test('anyone else sees only their own', () => {
  assert.deepEqual(
    filterCompaniesOpenTo(COMPANIES, { role: 'salesman', company_id: 'B' }),
    [{ id: 'B' }]
  );
});

test('a staff account attached to no company sees none', () => {
  assert.deepEqual(filterCompaniesOpenTo(COMPANIES, { role: 'accountant', company_id: null }), []);
});

test('no session sees none, rather than all of them', () => {
  assert.deepEqual(filterCompaniesOpenTo(COMPANIES, null), []);
});
