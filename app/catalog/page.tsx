import Image from 'next/image';
import Link from 'next/link';
import { PackageSearch } from 'lucide-react';
import { listPublishedCatalogProducts } from '@/lib/db';

export const dynamic = 'force-dynamic';

const AVAILABILITY_LABEL: Record<string, string> = {
  in_stock: 'In Stock',
  out_of_stock: 'Out of Stock',
  contact_for_availability: 'Contact for Availability',
};

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

  return (
    <div>
      <h1 className="page-title mb-2">Spare Parts Catalog</h1>
      <p className="page-subtitle mb-6">{products.length} part{products.length === 1 ? '' : 's'} available</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '20px' }}>
        {products.map((p) => (
          <Link key={String(p.id)} href={`/catalog/${p.id}`} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px', textDecoration: 'none', color: 'inherit' }}>
            <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--bg-input)' }}>
              {p.image_url ? (
                <Image src={String(p.image_url)} alt={String(p.title)} fill sizes="240px" style={{ objectFit: 'contain' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <PackageSearch size={32} color="var(--text-muted)" />
                </div>
              )}
            </div>
            <div>
              <div className="font-semibold truncate">{String(p.title)}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{String(p.part_number || '')}</div>
            </div>
            <div className="flex items-center justify-between">
              <span className="badge badge-info">{String(p.category || 'Parts')}</span>
              <span className="font-semibold">{p.price != null ? `₹${p.price}` : 'Quote'}</span>
            </div>
            <span className={`badge ${p.availability === 'in_stock' ? 'badge-success' : p.availability === 'out_of_stock' ? 'badge-danger' : 'badge-muted'}`} style={{ alignSelf: 'flex-start' }}>
              {AVAILABILITY_LABEL[String(p.availability)] || 'Contact for Availability'}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
