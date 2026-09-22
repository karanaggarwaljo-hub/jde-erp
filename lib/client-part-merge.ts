import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';

export type MergePartsInput = {
  companyId: string;
  keepId: string;
  removeId: string;
  /** One of the two parts' own numbers, or blank when neither has one. */
  partNumber: string;
  /** How the duplicate is named in the audit log once it no longer exists. */
  removeLabel: string;
};

export type MergePartsResult = {
  id: string;
  part_number: string;
  name: string;
  current_stock: number;
  moved_lines: number;
  recosted_units: number;
};

/** Merges a part that was entered twice into the entry being kept, in one database transaction. */
export async function mergeParts(input: MergePartsInput): Promise<MergePartsResult> {
  const response = await fetch('/api/inventory/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return await parseJsonOrThrow(response, 'Merging these parts failed') as MergePartsResult;
}
