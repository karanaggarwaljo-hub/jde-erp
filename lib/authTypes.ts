/** Canonical role list — was previously duplicated (and drifting: "Salesman" vs "Salesperson",
 *  "Store Manager" vs "Manager") between the old fake login dropdown and the Settings page's
 *  Invite/Edit Role dropdowns. Labels below match Settings, since that's the surviving UI. */
export const ROLES = ['owner', 'manager', 'salesman', 'accountant', 'warehouse'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner / Admin',
  manager: 'Manager',
  salesman: 'Salesperson',
  accountant: 'Accountant',
  warehouse: 'Warehouse',
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
