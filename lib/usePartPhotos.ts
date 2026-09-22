'use client';

import { useCallback, useMemo } from 'react';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { catalogPhotoIndex, photoOf, type CatalogPhotoRow, type PartPhotoRef } from '@/lib/part-photos';

/** The picture for any part on a screen: its own photo, else its published catalog picture. One
 *  place decides, so Inventory, a sale and a purchase always show the same picture for a part. */
export function usePartPhotos(): (product: { id: string; image_url?: string | null }) => PartPhotoRef | null {
  const { rows } = useCompanyTable<CatalogPhotoRow & Record<string, unknown>>('catalog_products');
  const index = useMemo(() => catalogPhotoIndex(rows), [rows]);
  return useCallback((product: { id: string; image_url?: string | null }) => photoOf(product, index), [index]);
}
