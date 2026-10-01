import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import type { StartFreshCounts } from '@/lib/start-fresh';

export type StartFreshOutcome = { result: Record<string, number>; summary: string; backup: string };

export async function fetchStartFreshCounts(companyId: string): Promise<StartFreshCounts> {
  const response = await fetch(`/api/company/start-fresh?companyId=${encodeURIComponent(companyId)}`);
  return await parseJsonOrThrow(response, 'Could not count what would be cleared') as StartFreshCounts;
}

/** Takes a full backup, then starts the company fresh — or changes nothing at all. */
export async function startCompanyFresh(companyId: string, confirm: string): Promise<StartFreshOutcome> {
  const response = await fetch('/api/company/start-fresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId, confirm }),
  });
  return await parseJsonOrThrow(response, 'Starting fresh failed') as StartFreshOutcome;
}
