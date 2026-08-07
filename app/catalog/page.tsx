import Link from 'next/link';
import { PackageSearch } from 'lucide-react';
import { getCompanyPublicContact, getStorefrontCompanyId, listPublishedCatalogProducts } from '@/lib/db';
import CatalogBrowser, { type PublicCatalogProduct } from './CatalogBrowser';

export const dynamic = 'force-dynamic';

export default async function CatalogListPage() {
  const products = await listPublishedCatalogProducts();

  if (products.length === 0) {
    return (
      <div className="empty-state">
        <PackageSearch size={28} />
        <p className="empty-state-title">No parts published yet</p>
        <p className="empty-state-desc">Check back soon — new listings are added regularly.</p>
      </div>
    );
  }

  // Every listed product belongs to the same storefront company after the multi-company scoping
  // fix, so one contact lookup covers the whole page — each card's "Quick Quote" button reuses it
  // rather than fetching contact info per product.
  const companyId = await getStorefrontCompanyId();
  const contact = companyId ? await getCompanyPublicContact(companyId) : undefined;

  return (
    <div>
      <nav aria-label="Breadcrumb" style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
        <Link href="/catalog" style={{ color: 'var(--text-muted)' }}>Home</Link>
        <span style={{ margin: '0 6px' }}>›</span>
        <span style={{ color: 'var(--text-primary)' }}>Spare Parts Catalog</span>
      </nav>
      <h1 className="page-title mb-4">Spare Parts Catalog</h1>
      <CatalogBrowser products={products as unknown as PublicCatalogProduct[]} contact={contact} />
    </div>
  );
}
