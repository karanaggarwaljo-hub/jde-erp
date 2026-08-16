import { requireOwner } from '@/lib/auth/dal';
import SettingsClient from './SettingsClient';

// proxy.ts already blocks non-owners from reaching this route at all (see its
// isOwnerOnlyPath) — this is the independent, full-strength defense-in-depth check for the
// one screen that can delete a whole company or change other people's access, worth its own
// real round trip rather than trusting the header-based check layout.tsx does for every page.
export default async function SettingsPage() {
  await requireOwner();
  return <SettingsClient />;
}
