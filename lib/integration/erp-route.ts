import {
  ErpIntegrationError,
  erpIntegrationHeaders,
  parseErpIntegrationRequest,
} from './erp-contract';
import { getInventoryBalance, listInventoryMovements, listPurchaseOrders } from './erp-read-service';

export type ErpReadOperation = 'inventory-balance' | 'inventory-movements' | 'purchase-orders';

export async function handleErpReadRequest(request: Request, operation: ErpReadOperation): Promise<Response> {
  let correlationId: string | undefined;
  try {
    const query = parseErpIntegrationRequest(request);
    correlationId = query.correlationId;
    const payload = operation === 'inventory-balance'
      ? await getInventoryBalance(query)
      : operation === 'inventory-movements'
        ? await listInventoryMovements(query)
        : await listPurchaseOrders(query);
    return Response.json(payload, { headers: erpIntegrationHeaders(correlationId) });
  } catch (error) {
    if (error instanceof ErpIntegrationError) {
      return Response.json(
        { error: error.message },
        {
          status: error.status,
          headers: {
            ...erpIntegrationHeaders(correlationId),
            ...(error.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}),
          },
        },
      );
    }
    console.error('ERP read integration failed:', { operation, correlationId, error });
    return Response.json(
      { error: 'The ERP read integration is temporarily unavailable.' },
      { status: 500, headers: erpIntegrationHeaders(correlationId) },
    );
  }
}
