import { handleErpReadRequest } from '@/lib/integration/erp-route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleErpReadRequest(request, 'purchase-orders');
}
