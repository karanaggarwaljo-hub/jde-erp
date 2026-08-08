import Link from 'next/link';
import { PackageSearch } from 'lucide-react';
import { getCompanyPublicContact, getStorefrontCompanyId, listPublishedCatalogProducts } from '@/lib/db';
import CatalogBrowser, { type PublicCatalogProduct } from './CatalogBrowser';

export const dynamic = 'force-dynamic';

export default async function CatalogListPage() {
  // Data-fetching lives in its own try/catch, fully separate from the JSX below — React defers
  // rendering, so a try/catch wrapped around JSX construction never actually catches a rendering
  // error; only synchronous data-fetching errors belong here.
  let products: Array<Record<string, unknown>>;
  let contact: { contact_email: string | null; contact_phone: string | null } | undefined;
  try {
    products = await listPublishedCatalogProducts();
    // Every listed product belongs to the same storefront company after the multi-company scoping
    // fix, so one contact lookup covers the whole page — each card's "Quick Quote" button reuses it
    // rather than fetching contact info per product. Skipped entirely when there are no products,
    // since the empty state below doesn't use it.
    const companyId = products.length > 0 ? await getStorefrontCompanyId() : undefined;
    contact = companyId ? await getCompanyPublicContact(companyId) : undefined;
  } catch (error) {
    // Anonymous public visitors must never see a raw framework 500 page or a leaked Supabase
    // error message — log the real cause server-side for diagnosis, and show the same friendly
    // empty-state visual used below for the (legitimate) zero-products case, just with different
    // copy so it reads as "come back later" rather than "there's nothing here".
    console.error('CatalogListPage failed to load:', error);
    return (
      <div className="empty-state">
        <PackageSearch size={28} />
        <p className="empty-state-title">Catalog temporarily unavailable</p>
        <p className="empty-state-desc">Please check back soon.</p>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="empty-state">
        <PackageSearch size={28} />
        <p className="empty-state-title">No parts published yet</p>
        <p className="empty-state-desc">Check back soon — new listings are added regularly.</p>
      </div>
    );
  }

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
