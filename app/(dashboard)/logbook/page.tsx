import { requireOwner } from '@/lib/auth/dal';
import LogBook from '@/components/LogBook';

// Owner-only like Settings: the book records what every member of staff did. proxy.ts blocks other
// roles before they get here; this is the independent check.
export default async function LogBookPage() {
  await requireOwner();
  return <LogBook />;
}
