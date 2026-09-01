import { isRole } from '../authTypes';
import { authenticateErpIntegration, ErpIntegrationError, erpIntegrationHeaders } from './erp-contract';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface AdaptiveIdentityDependencies {
  issuer: string;
  verifyUser(token: string): Promise<{ id: string; email?: string; emailConfirmed: boolean } | null>;
  findStaff(email: string): Promise<{ email: string; company_id: string | null; role: string; status: string } | undefined>;
  companyExists(id: string): Promise<boolean>;
}

/** Both credentials are mandatory. Never treats the machine credential as a user identity. */
export async function handleAdaptiveIdentity(
  request: Request,
  dependencies: AdaptiveIdentityDependencies,
  environment: Record<string, string | undefined> = process.env,
): Promise<Response> {
  try {
    authenticateErpIntegration(request, environment);
    const organizationId = request.headers.get('x-organization-id') ?? '';
    const accessToken = request.headers.get('x-erp-user-token') ?? '';
    if (!uuid.test(organizationId) || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(accessToken) || accessToken.length > 16_384) {
      throw new ErpIntegrationError(401, 'A valid user session and company selection are required.');
    }
    const user = await dependencies.verifyUser(accessToken);
    if (!user?.email || !user.emailConfirmed || !uuid.test(user.id)) {
      throw new ErpIntegrationError(401, 'Authentication required.');
    }
    const staff = await dependencies.findStaff(user.email);
    if (!staff || staff.email.toLowerCase() !== user.email.toLowerCase() || staff.status !== 'active' || !isRole(staff.role)) {
      throw new ErpIntegrationError(403, 'Active staff access is required.');
    }
    // Match the existing ERP DAL: owners manage all companies; other staff only their assigned company.
    if ((staff.role !== 'owner' && staff.company_id !== organizationId) || !(await dependencies.companyExists(organizationId))) {
      throw new ErpIntegrationError(403, 'Company access denied.');
    }
    return Response.json({ issuer: dependencies.issuer, subject: user.id, organizationId, role: staff.role }, {
      headers: erpIntegrationHeaders(),
    });
  } catch (error) {
    // No token, email, provider error or staff record is logged or returned on failure.
    const status = error instanceof ErpIntegrationError ? error.status : 503;
    const message = error instanceof ErpIntegrationError ? error.message : 'Identity verification is temporarily unavailable.';
    return Response.json({ error: message }, { status, headers: erpIntegrationHeaders() });
  }
}
