import { requireOwner } from '@/lib/auth/dal';
import Cheques from '@/components/money/Cheques';

// Owner-only, like the Log Book. proxy.ts blocks other roles first; this is the independent check.
export default async function ChequesPage() {
  await requireOwner();
  return <Cheques />;
}
