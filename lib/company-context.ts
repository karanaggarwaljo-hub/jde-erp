import { cookies } from 'next/headers';
import { getCurrentUser } from '@/lib/auth/dal';
import { companyExists, getActiveCompanyId, listRows } from '@/lib/db';

/**
 * Which company the person making THIS request is working in.
 *
 * It used to be a single row in the database: `jde_companies.is_active`, one true at a time for
 * the whole installation. That was fine while the ERP only ran on one shop PC. It stopped being
 * fine the moment it moved to a web address with real per-person logins — switching company on one
 * screen switched it for everybody, so a second person could be halfway through entering an
 * invoice and have it saved against a different company's books without anything visibly changing.
 *
 * The choice now lives in a cookie, which is per person and per browser. The database flag is kept
 * only as the starting point for somebody who has never chosen (and for the nightly backup and
 * other jobs, which have no session at all). Nothing here trusts the cookie: whatever it says is
 * checked against what that person is actually allowed to open before it is used.
 */

export const COMPANY_COOKIE = 'jde_company';

/** A year. The choice is a preference, not a credential — it carries no access of its own, since
 *  every use of it is re-checked against the person's real permissions. */
const COMPANY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Whether this person may work in this company at all. Mirrors checkCompanyAccess: an owner may
 *  open any company, anyone else only their own. */
async function mayOpen(companyId: string): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  if (user.role === 'owner') return await companyExists(companyId);
  return user.company_id === companyId;
}

export type CompanyChoice = {
  /** What the cookie says, if anything. */
  chosen?: string;
  /** Whether this person may actually open that company. A cookie is a preference, never a key. */
  chosenAllowed: boolean;
  /** The company this person's own account belongs to. */
  userCompanyId?: string | null;
  /** jde_companies.is_active — the installation-wide default, and all a job with no session has. */
  installationDefault?: string;
};

/**
 * Which company a request works in, in order of preference:
 *   1. what this person chose, if they are still allowed to open it
 *   2. the company their own account belongs to
 *   3. the installation-wide default
 * Returns undefined only when there is no company at all to fall back on.
 *
 * Pure, and separate from the reading of cookies and the database, so the order of preference can
 * be tested directly — it is the part that decides whose books a saved invoice lands in.
 */
export function pickCompanyId(choice: CompanyChoice): string | undefined {
  if (choice.chosen && choice.chosenAllowed) return choice.chosen;
  if (choice.userCompanyId) return choice.userCompanyId;
  return choice.installationDefault;
}

/** The company to use for this request. See pickCompanyId for the order of preference. */
export async function resolveRequestCompanyId(): Promise<string | undefined> {
  const chosen = (await cookies()).get(COMPANY_COOKIE)?.value;
  const user = await getCurrentUser();
  return pickCompanyId({
    chosen,
    chosenAllowed: Boolean(chosen) && (await mayOpen(chosen as string)),
    userCompanyId: user?.company_id,
    installationDefault: await getActiveCompanyId(),
  });
}

/** Records this person's choice for their own browser. Returns false when they may not open it,
 *  in which case nothing is written. */
export async function chooseCompany(companyId: string): Promise<boolean> {
  if (!await mayOpen(companyId)) return false;
  (await cookies()).set(COMPANY_COOKIE, companyId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COMPANY_COOKIE_MAX_AGE,
  });
  return true;
}

/** Every company this person may switch between. An owner sees all of them; anybody else sees only
 *  their own, so the switcher cannot offer a company that would be refused on the next request. */
export function filterCompaniesOpenTo<T extends { id: string }>(
  companies: T[],
  user: { role: string; company_id?: string | null } | null
): T[] {
  if (!user) return [];
  if (user.role === 'owner') return companies;
  return companies.filter((company) => company.id === user.company_id);
}

export async function companiesOpenTo(): Promise<Array<Record<string, unknown>>> {
  const [user, companies] = await Promise.all([getCurrentUser(), listRows('companies')]);
  return filterCompaniesOpenTo(companies as Array<Record<string, unknown> & { id: string }>, user);
}
