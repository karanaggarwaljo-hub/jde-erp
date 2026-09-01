import assert from 'node:assert/strict';
import test from 'node:test';
import { isServiceAuthenticatedPath } from '../proxy';

test('machine-authenticated integration and reconciliation routes bypass only the browser-session gate', () => {
  assert.equal(isServiceAuthenticatedPath('/api/integration/v1/identity'), true);
  assert.equal(isServiceAuthenticatedPath('/api/internal/adaptive-platform/company-events'), true);
  assert.equal(isServiceAuthenticatedPath('/api/internal/anything-else'), false);
  assert.equal(isServiceAuthenticatedPath('/api/local/companies'), false);
});
