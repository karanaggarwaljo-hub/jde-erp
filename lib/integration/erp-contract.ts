import { timingSafeEqual } from 'node:crypto';

const IDENTIFIER = /^[A-Za-z0-9_.:@/-]{1,160}$/u;
const MAX_RANGE_MS = 366 * 86_400_000;
const MINIMUM_TOKEN_LENGTH = 32;

export type ErpIntegrationEnvironment = Record<string, string | undefined>;

export type ErpIntegrationQuery = {
  organizationId: string;
  productId: string;
  warehouseId: string;
  from: Date;
  to: Date;
  correlationId: string;
  unitOfMeasure: string;
};

export class ErpIntegrationError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 503,
    message: string,
  ) {
    super(message);
    this.name = 'ErpIntegrationError';
  }
}

/**
 * Authenticates one server-to-server request and parses the common, bounded query contract.
 * Configuration failures are deliberately different from caller failures so a deployment with
 * no secret never falls back to accepting unauthenticated requests. Company isolation happens in
 * every read query by matching both organizationId and productId. Because the company registry is
 * not copied into deployment configuration, a new jde_companies row is usable immediately.
 */
export function parseErpIntegrationRequest(
  request: Request,
  environment: ErpIntegrationEnvironment = process.env,
): ErpIntegrationQuery {
  authenticateErpIntegration(request, environment);

  const configuredWarehouseId = environment.ERP_INTEGRATION_WAREHOUSE_ID?.trim() || 'default';
  const unitOfMeasure = environment.ERP_INTEGRATION_UNIT_OF_MEASURE?.trim() || 'EA';
  if (!IDENTIFIER.test(configuredWarehouseId) || !/^[A-Za-z0-9._/-]{1,32}$/u.test(unitOfMeasure)) {
    throw new ErpIntegrationError(503, 'ERP integration inventory settings are invalid.');
  }

  const url = new URL(request.url);
  const organizationId = requiredIdentifier(url.searchParams, 'organizationId');
  const productId = requiredIdentifier(url.searchParams, 'productId');
  const warehouseId = requiredIdentifier(url.searchParams, 'warehouseId');
  const correlationId = request.headers.get('x-correlation-id') ?? '';
  if (!IDENTIFIER.test(correlationId)) {
    throw new ErpIntegrationError(400, 'X-Correlation-ID is required and must be a valid identifier.');
  }
  if (warehouseId !== configuredWarehouseId) {
    throw new ErpIntegrationError(400, `This ERP exposes inventory through warehouse ${configuredWarehouseId}.`);
  }

  const from = requiredDate(url.searchParams, 'from');
  const to = requiredDate(url.searchParams, 'to');
  if (from >= to) throw new ErpIntegrationError(400, 'The ERP integration date range is invalid.');
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    throw new ErpIntegrationError(400, 'The ERP integration date range cannot exceed 366 days.');
  }

  return { organizationId, productId, warehouseId, from, to, correlationId, unitOfMeasure };
}

export function authenticateErpIntegration(
  request: Request,
  environment: ErpIntegrationEnvironment = process.env,
): void {
  const configuredTokens = [environment.ERP_INTEGRATION_TOKEN, environment.ERP_INTEGRATION_PREVIOUS_TOKEN]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (configuredTokens.length === 0 || configuredTokens.some((token) => token.length < MINIMUM_TOKEN_LENGTH)) {
    throw new ErpIntegrationError(503, 'ERP integration authentication is not configured.');
  }

  const authorization = request.headers.get('authorization') ?? '';
  const bearer = /^Bearer ([^\s,]{1,512})$/u.exec(authorization)?.[1];
  const authenticated = bearer !== undefined && configuredTokens.some((token) => constantTimeEqual(bearer, token));
  if (!authenticated) throw new ErpIntegrationError(401, 'Authentication required.');
}

export function erpIntegrationHeaders(correlationId?: string): HeadersInit {
  return {
    'Cache-Control': 'private, no-store, max-age=0',
    Pragma: 'no-cache',
    Vary: 'Authorization',
    'X-Content-Type-Options': 'nosniff',
    ...(correlationId ? { 'X-Correlation-ID': correlationId } : {}),
  };
}

export function sourceUri(...segments: string[]): string {
  return `jde-erp://${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
}

export function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ErpIntegrationError(409, `ERP data contains an invalid ${field}.`);
  }
  const normalized = /^\d{4}-\d{2}-\d{2}$/u.test(value) ? `${value}T00:00:00.000Z` : value;
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ErpIntegrationError(409, `ERP data contains an invalid ${field}.`);
  }
  return parsed.toISOString();
}

export function isWithinRange(value: string, from: Date, to: Date): boolean {
  const milliseconds = new Date(value).getTime();
  return milliseconds >= from.getTime() && milliseconds <= to.getTime();
}

function requiredIdentifier(parameters: URLSearchParams, name: string): string {
  const value = parameters.get(name) ?? '';
  if (!IDENTIFIER.test(value)) throw new ErpIntegrationError(400, `${name} is missing or invalid.`);
  return value;
}

function requiredDate(parameters: URLSearchParams, name: string): Date {
  const value = parameters.get(name) ?? '';
  if (!value.includes('T')) throw new ErpIntegrationError(400, `${name} must be an ISO-8601 timestamp.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ErpIntegrationError(400, `${name} must be an ISO-8601 timestamp.`);
  }
  return parsed;
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  const length = Math.max(actualBytes.length, expectedBytes.length, 1);
  const paddedActual = Buffer.alloc(length);
  const paddedExpected = Buffer.alloc(length);
  actualBytes.copy(paddedActual);
  expectedBytes.copy(paddedExpected);
  return timingSafeEqual(paddedActual, paddedExpected) && actualBytes.length === expectedBytes.length;
}
