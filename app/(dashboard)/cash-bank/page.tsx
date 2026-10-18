import { requireOwner } from '@/lib/auth/dal';
import CashBank from '@/components/money/CashBank';

// Owner-only like Settings: it shows what is in the drawer and the bank. proxy.ts blocks other
// roles before they get here; this is the independent check.
export default async function CashBankPage() {
  await requireOwner();
  return <CashBank />;
}
