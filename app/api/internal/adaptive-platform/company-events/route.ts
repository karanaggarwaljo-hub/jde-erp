import { timingSafeEqual } from 'node:crypto';
import { dispatchPendingCompanyEvents } from '@/lib/integration/adaptive-platform-company-events';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const configured = process.env.CRON_SECRET;
  if (!configured || configured.length < 16 || !constantTimeEqual(request.headers.get('authorization'), `Bearer ${configured}`)) {
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
