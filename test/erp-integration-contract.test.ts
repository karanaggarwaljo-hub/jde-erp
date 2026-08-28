import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ErpIntegrationError,
  parseErpIntegrationRequest,
  sourceUri,
  timestamp,
  type ErpIntegrationEnvironment,
} from '../lib/integration/erp-contract';
import { mapPurchaseOrderStatus } from '../lib/integration/erp-read-service';

const token = 'integration-test-token-with-more-than-32-characters';
const environment: ErpIntegrationEnvironment = {
  ERP_INTEGRATION_TOKEN: token,
  ERP_INTEGRATION_ALLOWED_COMPANY_IDS: 'company-1,company-2',
  ERP_INTEGRATION_WAREHOUSE_ID: 'default',
  ERP_INTEGRATION_UNIT_OF_MEASURE: 'EA',
};

function request(overrides: { token?: string; company?: string; warehouse?: string; from?: string; to?: string } = {}) {
  const parameters = new URLSearchParams({
    organizationId: overrides.company ?? 'company-1',
    productId: 'SP-1001',
    warehouseId: overrides.warehouse ?? 'default',
    from: overrides.from ?? '2026-08-01T00:00:00.000Z',
    to: overrides.to ?? '2026-08-29T00:00:00.000Z',
  });
  return new Request(`https://erp.example/api/integration/v1/inventory/balance?${parameters}`, {
    headers: {
      Authorization: `Bearer ${overrides.token ?? token}`,
      'X-Correlation-ID': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  });
}

test('authenticates and parses a company-scoped integration request', () => {
  const parsed = parseErpIntegrationRequest(request(), environment);
  assert.equal(parsed.organizationId, 'company-1');
  assert.equal(parsed.productId, 'SP-1001');
  assert.equal(parsed.warehouseId, 'default');
  assert.equal(parsed.unitOfMeasure, 'EA');
});

test('rejects an invalid bearer token without exposing configuration', () => {
  assert.throws(
    () => parseErpIntegrationRequest(request({ token: 'wrong-token-with-more-than-32-characters' }), environment),
    (error: unknown) => error instanceof ErpIntegrationError && error.status === 401,
  );
});

test('fails closed when token or company allowlist configuration is incomplete', () => {
  assert.throws(
    () => parseErpIntegrationRequest(request(), { ...environment, ERP_INTEGRATION_TOKEN: 'short' }),
    (error: unknown) => error instanceof ErpIntegrationError && error.status === 503,
  );
  assert.throws(
    () => parseErpIntegrationRequest(request(), { ...environment, ERP_INTEGRATION_ALLOWED_COMPANY_IDS: '' }),
    (error: unknown) => error instanceof ErpIntegrationError && error.status === 503,
  );
});

test('rejects companies outside the credential allowlist and unsupported warehouses', () => {
  assert.throws(
    () => parseErpIntegrationRequest(request({ company: 'company-3' }), environment),
    (error: unknown) => error instanceof ErpIntegrationError && error.status === 403,
  );
  assert.throws(
    () => parseErpIntegrationRequest(request({ warehouse: 'warehouse-2' }), environment),
    (error: unknown) => error instanceof ErpIntegrationError && error.status === 400,
  );
});

test('rejects reversed and over-broad date ranges', () => {
  assert.throws(
    () => parseErpIntegrationRequest(request({ from: '2026-08-30T00:00:00.000Z' }), environment),
    (error: unknown) => error instanceof ErpIntegrationError && error.status === 400,
  );
  assert.throws(
    () => parseErpIntegrationRequest(request({ from: '2024-01-01T00:00:00.000Z' }), environment),
    (error: unknown) => error instanceof ErpIntegrationError && error.status === 400,
  );
});

test('normalizes supported purchase statuses and rejects unknown values', () => {
  assert.equal(mapPurchaseOrderStatus('pending'), 'approved');
  assert.equal(mapPurchaseOrderStatus('partially received'), 'partially_received');
  assert.equal(mapPurchaseOrderStatus('received'), 'received');
  assert.throws(
    () => mapPurchaseOrderStatus('mystery'),
    (error: unknown) => error instanceof ErpIntegrationError && error.status === 409,
  );
});

test('normalizes stored dates and percent-encodes audit source URIs', () => {
  assert.equal(timestamp('2026-08-29', 'date'), '2026-08-29T00:00:00.000Z');
  assert.equal(
    sourceUri('companies', 'company/one', 'products', 'SP 1001'),
    'jde-erp://companies/company%2Fone/products/SP%201001',
  );
});
