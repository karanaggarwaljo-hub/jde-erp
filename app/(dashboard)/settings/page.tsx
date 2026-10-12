import { requireOwner } from '@/lib/auth/dal';
import SettingsClient, { type SettingsTab } from './SettingsClient';

// proxy.ts already blocks non-owners from reaching this route at all (see its
// isOwnerOnlyPath) — this is the independent, full-strength defense-in-depth check for the
// one screen that can delete a whole company or change other people's access, worth its own
// real round trip rather than trusting the header-based check layout.tsx does for every page.
// ?drive=connected|error&message=… is where /api/drive/callback sends the owner back from Google.
export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwner();
  const params = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';
  const drive = one(params.drive);
  const tab = one(params.tab);
  const initialTab: SettingsTab = drive || tab === 'drive' ? 'drive' : tab === 'backups' || tab === 'company' ? tab : 'users';
  const driveOutcome = drive === 'connected'
    ? { ok: true, message: 'Google Drive is connected. Bills and invoice PDFs already in the ERP are being copied there now.' }
    : drive === 'error' ? { ok: false, message: one(params.message) || 'Google Drive could not be connected.' } : null;
  return <SettingsClient initialTab={initialTab} driveOutcome={driveOutcome} />;
}
