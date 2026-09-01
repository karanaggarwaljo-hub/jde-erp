import assert from 'node:assert/strict';
import test from 'node:test';
import { handleAdaptiveIdentity, type AdaptiveIdentityDependencies } from '../lib/integration/adaptive-identity';

const company = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const subject = '33333333-3333-4333-8333-333333333333';
const token = 'test-only-machine-token-longer-than-32-characters';
const issuer = 'https://test.supabase.co/auth/v1';
const environment = { ERP_INTEGRATION_TOKEN: token };
function request(headers: Record<string, string> = {}) {
  return new Request('https://erp.example/api/integration/v1/identity', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-organization-id': company, 'x-erp-user-token': 'header.payload.signature', ...headers },
  });
}
function dependencies(overrides: Partial<AdaptiveIdentityDependencies> = {}): AdaptiveIdentityDependencies {
  return {
    issuer,
    async verifyUser(value) {
      assert.equal(value, 'header.payload.signature');
      return { id: subject, email: 'staff@example.test', emailConfirmed: true };
    },
    async findStaff(email) { return { email, company_id: company, role: 'warehouse', status: 'active' }; },
    async companyExists(id) { return id === company; },
    ...overrides,
  };
}

test('returns only verified identity fields and disables caching', async () => {
  const response = await handleAdaptiveIdentity(request({ 'x-skill-scopes': 'skills.approve', 'x-jde-user-role': 'owner' }), dependencies(), environment);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { issuer, subject, organizationId: company, role: 'warehouse' });
  assert.match(response.headers.get('cache-control')!, /no-store/);
});

test('machine authentication happens before user verification or database reads', async () => {
  let calls = 0;
  const deps = dependencies({ async verifyUser() { calls++; throw new Error(); } });
  for (const authorization of ['', 'Bearer wrong', 'Bearer header.payload.signature']) {
    assert.equal((await handleAdaptiveIdentity(request({ authorization }), deps, environment)).status, 401);
  }
  assert.equal((await handleAdaptiveIdentity(request(), deps, {})).status, 503);
  assert.equal(calls, 0);
});

test('rejects absent, malformed, oversized user tokens and invalid company selectors', async () => {
  let calls = 0;
  const deps = dependencies({ async verifyUser() { calls++; return null; } });
  for (const value of ['', 'not-a-jwt', 'a.b.' + 'c'.repeat(16_384)]) {
    assert.equal((await handleAdaptiveIdentity(request({ 'x-erp-user-token': value }), deps, environment)).status, 401);
  }
  assert.equal((await handleAdaptiveIdentity(request({ 'x-organization-id': 'company-1' }), deps, environment)).status, 401);
  assert.equal(calls, 0);
});

test('denies invalid sessions, unconfirmed emails and non-active staff', async () => {
  for (const verified of [null, { id: subject, email: 'staff@example.test', emailConfirmed: false }]) {
    assert.equal((await handleAdaptiveIdentity(request(), dependencies({ async verifyUser() { return verified; } }), environment)).status, 401);
  }
  for (const status of ['invited', 'disabled', 'inactive']) {
    const deps = dependencies({ async findStaff(email) { return { email, company_id: company, role: 'owner', status }; } });
    assert.equal((await handleAdaptiveIdentity(request(), deps, environment)).status, 403);
  }
});

test('denies unknown roles, absent staff and mismatched email records', async () => {
  for (const staff of [undefined, { email: 'staff@example.test', company_id: company, role: 'admin', status: 'active' },
    { email: 'other@example.test', company_id: company, role: 'owner', status: 'active' }]) {
    assert.equal((await handleAdaptiveIdentity(request(), dependencies({ async findStaff() { return staff; } }), environment)).status, 403);
  }
});

test('non-owners cannot select another company; owners still require an existing company', async () => {
  let existenceChecks = 0;
  const deps = dependencies({ async companyExists() { existenceChecks++; return true; } });
  assert.equal((await handleAdaptiveIdentity(request({ 'x-organization-id': other }), deps, environment)).status, 403);
  assert.equal(existenceChecks, 0);
  const owner = dependencies({ async findStaff(email) { return { email, company_id: other, role: 'owner', status: 'active' }; } });
  assert.equal((await handleAdaptiveIdentity(request(), owner, environment)).status, 200);
  assert.equal((await handleAdaptiveIdentity(request({ 'x-organization-id': other }), owner, environment)).status, 403);
});

test('role changes and disabled accounts are observed on the next request, without identity caching', async () => {
  let status = 'active';
  let role = 'owner';
  const deps = dependencies({ async findStaff(email) { return { email, company_id: company, role, status }; } });
  assert.equal((await (await handleAdaptiveIdentity(request(), deps, environment)).json()).role, 'owner');
  role = 'warehouse';
  assert.equal((await (await handleAdaptiveIdentity(request(), deps, environment)).json()).role, 'warehouse');
  status = 'inactive';
  assert.equal((await handleAdaptiveIdentity(request(), deps, environment)).status, 403);
});

test('provider failures fail closed without leaking sensitive error details', async () => {
  for (const operation of ['verifyUser', 'findStaff', 'companyExists'] as const) {
    const response = await handleAdaptiveIdentity(request(), dependencies({ [operation]: async () => { throw new Error('sensitive-token'); } }), environment);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sensitive-token/);
  }
});
