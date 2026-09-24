import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import type { AlternateReason } from '@/lib/part-alternates';
import type { PartOverview } from '@/lib/part-overview';

export type PartDetailPart = {
  id: string;
  part_number: string;
  oem_number: string;
  hsn_code: string;
  name: string;
  brand: string;
  category: string;
  compatibility: string;
  location: string;
  cost_price: number;
  mrp: number;
  sale_price: number;
  current_stock: number;
  min_stock: number;
  image_url: string | null;
};

export type PartDetailAlternate = {
  id: string;
  part_number: string;
  name: string;
  brand: string;
  compatibility: string;
  current_stock: number;
  sale_price: number;
  why: AlternateReason;
  detail: string;
};

export type PartDetail = {
  part: PartDetailPart;
  overview: PartOverview;
  alternates: PartDetailAlternate[];
  /** Its published Website Catalog picture, used only when it has no photo of its own. */
  catalogPhoto: string | null;
  /** What its Website Catalog listing says it fits, offered when the part itself says nothing. */
  catalogFitment?: string | null;
};

/** Everything one part has and has done, in a single request. */
export async function fetchPartDetail(companyId: string, productId: string): Promise<PartDetail> {
  const params = new URLSearchParams({ companyId, productId });
  const response = await fetch(`/api/inventory/part?${params.toString()}`);
  return await parseJsonOrThrow(response, 'Could not load this part') as PartDetail;
}
