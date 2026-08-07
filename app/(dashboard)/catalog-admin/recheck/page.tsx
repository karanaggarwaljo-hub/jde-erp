'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { checkInventoryDrift, computeAvailabilityFromStock, hasInventoryDrift, type CatalogProduct } from '@/lib/catalogTypes';

type Product = { id: string; sale_price: number; current_stock: number };

const AVAILABILITY_LABEL: Record<CatalogProduct['availability'], string> = {
  in_stock: 'In Stock', out_of_stock: 'Out of Stock', contact_for_availability: 'Contact for Availability',
};

export default function CatalogRecheckPage() {
  const { rows: catalogRows, loading: catalogLoading, update } = useCompanyTable<CatalogProduct>('catalog_products');
  const { rows: products, loading: productsLoading } = useCompanyTable<Product>('products');
  const [busyId, setBusyId] = useState<string | null>(null);

  const loading = catalogLoading || productsLoading;

  /** Reuses the exact same drift-detection function the single-row edit screen
   *  (catalog-admin/[id]/page.tsx) already calls, just fanned out across every published
   *  row at once instead of one at a time — see lib/catalogTypes.ts for the shared logic. */
  const drifted = catalogRows
    .filter((row) => row.publication_status === 'published')
    .map((row) => {
      const product = products.find((p) => p.id === row.erp_product_id);
      return { row, product, drift: checkInventoryDrift(row, product) };
    })
    .filter(({ drift }) => hasInventoryDrift(drift));

  const syncFromInventory = async (row: CatalogProduct, product: Product) => {
    setBusyId(row.id);
    try {
      const liveAvailability = computeAvailabilityFromStock(product.current_stock);
      await update(row.id, { price: product.sale_price || null, availability: liveAvailability });
    } finally {
      setBusyId(null);
    }
  };

  const unpublishRow = async (row: CatalogProduct) => {
    setBusyId(row.id);
    try {
      await update(row.id, { publication_status: 'unpublished' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <Link href="/catalog-admin" className="btn btn-ghost btn-sm mb-2"><ArrowLeft size={14} /> Back to Website Catalog</Link>
          <h1 className="page-title">Recheck Against Inventory</h1>
          <p className="page-subtitle">Published listings whose price or availability no longer matches Inventory</p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">{loading ? 'Checking…' : `${drifted.length} listing(s) need attention`}</h3>
        </div>
        <div className="p-4 flex flex-col gap-4">
          {loading ? (
            <div className="empty-state">
              <p className="empty-state-title">Checking Inventory…</p>
            </div>
          ) : drifted.length === 0 ? (
            <div className="empty-state">
              <CheckCircle2 size={24} />
              <p className="empty-state-title">Everything matches Inventory</p>
              <p className="empty-state-desc">Every published listing&apos;s price and availability agrees with Inventory right now.</p>
            </div>
          ) : (
            drifted.map(({ row, product, drift }) => (
              <div key={row.id} className="alert alert-warning" role="alert" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <AlertTriangle size={14} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'text-bottom' }} />
                  <Link href={`/catalog-admin/${row.id}`} style={{ fontWeight: 600, color: 'inherit' }}>{row.title || '(untitled)'}</Link>
                  {row.part_number && <span style={{ marginLeft: '8px', fontFamily: 'monospace', fontSize: '12px' }}>{row.part_number}</span>}
                  {drift.productMissing ? (
                    <p style={{ margin: '6px 0 0 20px' }}>This part no longer exists in Inventory.</p>
                  ) : (
                    <ul style={{ margin: '6px 0 0 20px' }}>
                      {drift.priceDrift && <li>Inventory price is now ₹{drift.priceDrift.inventory} (this listing shows ₹{drift.priceDrift.catalog})</li>}
                      {drift.availabilityDrift && <li>Inventory now shows {AVAILABILITY_LABEL[drift.availabilityDrift.inventory]} (this listing shows {AVAILABILITY_LABEL[drift.availabilityDrift.catalog]})</li>}
                    </ul>
                  )}
                </div>
                <div>
                  {drift.productMissing ? (
                    <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busyId === row.id} onClick={() => unpublishRow(row)}>
                      {busyId === row.id ? 'Working…' : 'Unpublish'}
                    </button>
                  ) : (
                    <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busyId === row.id} onClick={() => product && syncFromInventory(row, product)}>
                      <RefreshCw size={14} /> {busyId === row.id ? 'Syncing…' : 'Sync from Inventory'}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
