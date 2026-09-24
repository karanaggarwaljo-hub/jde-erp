import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import type { PartFitmentResult } from '@/lib/part-fitment';

export async function savePartFitment(companyId: string, productId: string, compatibility: string): Promise<PartFitmentResult> {
  const response = await fetch('/api/inventory/fitment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId, productId, compatibility }),
  });
  return await parseJsonOrThrow(response, 'The fitment was not saved.') as PartFitmentResult;
}
