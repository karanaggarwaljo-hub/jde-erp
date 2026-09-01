import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson } from '../lib/integration/adaptive-platform-company-events';
import { GET } from '../app/api/internal/adaptive-platform/company-events/route';

test('canonicalizes company events identically for cross-service HMAC signatures', () => {
  const event = {
    type: 'company.created',
    eventId: '33333333-3333-4333-8333-333333333333',
    company: { name: 'Jai Durga Test', id: '11111111-1111-4111-8111-111111111111' },
    occurredAt: '2026-08-30T06:30:00.000Z',
  };
  assert.equal(
    canonicalJson(event),
    '{"company":{"id":"11111111-1111-4111-8111-111111111111","name":"Jai Durga Test"},"eventId":"33333333-3333-4333-8333-333333333333","occurredAt":"2026-08-30T06:30:00.000Z","type":"company.created"}',
  );
});

test('rejects an unauthenticated company-event reconciliation request', async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-cron-secret-long-enough-for-production';
  try {
    const response = await GET(new Request('https://erp.example/api/internal/adaptive-platform/company-events'));
    assert.equal(response.status, 401);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test('accepts the ERP machine credential as a reconciliation fallback', async () => {
  const previousCron = process.env.CRON_SECRET;
  const previousMachine = process.env.ERP_INTEGRATION_PREVIOUS_TOKEN;
  delete process.env.CRON_SECRET;
  process.env.ERP_INTEGRATION_PREVIOUS_TOKEN = 'test-machine-token-long-enough-for-production';
  try {
    const response = await GET(new Request('https://erp.example/api/internal/adaptive-platform/company-events', {
      headers: { authorization: `Bearer ${process.env.ERP_INTEGRATION_PREVIOUS_TOKEN}` },
    }));
    assert.notEqual(response.status, 401);
  } finally {
    if (previousCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousCron;
    if (previousMachine === undefined) delete process.env.ERP_INTEGRATION_PREVIOUS_TOKEN;
    else process.env.ERP_INTEGRATION_PREVIOUS_TOKEN = previousMachine;
  }
});
