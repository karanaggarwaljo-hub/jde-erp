import { timingSafeEqual } from 'node:crypto';
import { dispatchPendingCompanyEvents } from '@/lib/integration/adaptive-platform-company-events';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  // The dedicated cron secret is preferred. The already-authorized ERP machine
  // credentials are safe fallbacks because this endpoint can only deliver
  // existing outbox rows and returns aggregate counts, never company data.
  const configured = [process.env.CRON_SECRET, process.env.ERP_INTEGRATION_TOKEN, process.env.ERP_INTEGRATION_PREVIOUS_TOKEN]
    .filter((value): value is string => typeof value === 'string' && value.length >= 32);
  const authorization = request.headers.get('authorization');
  if (configured.length === 0 || !configured.some((secret) => constantTimeEqual(authorization, `Bearer ${secret}`))) {
    return Response.json({ error: 'Authentication required.' }, { status: 401 });
  }
  try {
    const result = await dispatchPendingCompanyEvents({ limit: 50 });
    return Response.json(result, { status: result.failed > 0 ? 503 : 200 });
  } catch (error: unknown) {
    console.error('Adaptive-platform company event dispatch failed:', error);
    return Response.json({ error: 'Company event dispatch failed.' }, { status: 503 });
  }
}

function constantTimeEqual(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
