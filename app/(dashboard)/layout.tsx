import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import DashboardChrome from '@/components/DashboardChrome';

export default async function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // proxy.ts is the real, primary gate (it already ran a full getUser() + jde_users check
  // before this request ever reached here) and forwards the resolved identity via these
  // headers. Reading them again here is cheap, header-only insurance against a matcher/config
  // mistake causing proxy.ts to be skipped for some path under this layout — not a second
  // full auth check. If they're missing, something's wrong; fail closed rather than render.
  const headerList = await headers();
  const email = headerList.get('x-jde-user-email');
  const role = headerList.get('x-jde-user-role');
  if (!email || !role) {
    redirect('/login');
  }
  const name = decodeURIComponent(headerList.get('x-jde-user-name') || '') || null;

  return <DashboardChrome currentUser={{ email, name, role }}>{children}</DashboardChrome>;
}
