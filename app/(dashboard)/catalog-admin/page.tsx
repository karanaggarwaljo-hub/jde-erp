'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Globe, Plus, Search, ExternalLink } from 'lucide-react';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { catalogDisplayStatus, type CatalogProduct } from '@/lib/catalogTypes';

type Product = {
  id: string;
  part_number: string;
  oem_number: string;
  name: string;
  brand: string;
  category: string;
  compatibility: string;
  sale_price: number;
  current_stock: number;
};

export default function CatalogAdminPage() {
  const router = useRouter();
  const { rows: products, loading: productsLoading } = useCompanyTable<Product>('products');
  const { rows: catalogRows, loading: catalogLoading, create } = useCompanyTable<CatalogProduct>('catalog_products');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState('');

  const catalogedProductIds = new Set(catalogRows.map((c) => c.erp_product_id));
  const uncataloged = products.filter((p) => !catalogedProductIds.has(p.id));
  const filteredUncataloged = uncataloged.filter((p) => {
    const q = search.toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || p.part_number.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q);
  });

  const addToCatalog = async (product: Product) => {
    setError('');
    setAdding(product.id);
    try {
      const created = await create({
        erp_product_id: product.id,
        title: product.name,
        part_number: product.part_number,
        oem_number: product.oem_number,
        category: product.category,
        brand: product.brand,
        compatibility: product.compatibility,
        price: product.sale_price || null,
        availability: product.current_stock > 0 ? 'in_stock' : 'out_of_stock',
      });
      router.push(`/catalog-admin/${created.id}`);
    } catch {
      setError(`Couldn't create a catalog draft for ${product.name} — it may already have one.`);
    } finally {
      setAdding(null);
    }
  };

  const sortedCatalogRows = [...catalogRows].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Website Catalog</h1>
          <p className="page-subtitle">Turn approved Inventory parts into public website listings — nothing goes live until you publish it</p>
        </div>
        <Link href="/catalog" target="_blank" className="btn btn-secondary">
          <ExternalLink size={16} /> View Public Site
        </Link>
      </div>

      {error && <div className="alert alert-danger mb-4" role="alert">{error}</div>}

      <div className="card mb-6">
        <div className="card-header">
          <h3 className="card-title">Catalog Drafts</h3>
        </div>
        <div className="table-wrap">
          <table className="erp-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Part Number</th>
                <th>Category</th>
                <th className="text-center">Status</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedCatalogRows.map((row) => {
                const status = catalogDisplayStatus(row);
                return (
                  <tr key={row.id}>
                    <td style={{ fontWeight: 600 }}>{row.title || '(untitled)'}</td>
                    <td><span style={{ fontFamily: 'monospace' }}>{row.part_number || '-'}</span></td>
                    <td>{row.category ? <span className="badge badge-info">{row.category}</span> : '-'}</td>
                    <td className="text-center"><span className={`badge ${status.cls}`}>{status.label}</span></td>
                    <td className="text-center">
                      <Link href={`/catalog-admin/${row.id}`} className="btn btn-ghost btn-sm">Open</Link>
                    </td>
                  </tr>
                );
              })}
              {sortedCatalogRows.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      <Globe size={24} />
                      <p className="empty-state-title">{catalogLoading ? 'Loading catalog…' : 'No catalog drafts yet'}</p>
                      <p className="empty-state-desc">Add a part from Inventory below to start a draft.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Add from Inventory</h3>
        </div>
        <div className="p-4 pt-0">
          <div className="search-bar mb-4">
            <Search className="search-bar-icon" size={16} />
            <input type="text" placeholder="Search parts not yet in the catalog…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="table-wrap">
          <table className="erp-table">
            <thead>
              <tr>
                <th>Part Number</th>
                <th>Item Name</th>
                <th>Brand</th>
                <th className="text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredUncataloged.slice(0, 50).map((p) => (
                <tr key={p.id}>
                  <td style={{ fontFamily: 'monospace' }}>{p.part_number}</td>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td>{p.brand || '-'}</td>
                  <td className="text-center">
                    <button className="btn btn-primary btn-sm" disabled={adding === p.id} onClick={() => addToCatalog(p)}>
                      <Plus size={14} /> {adding === p.id ? 'Adding…' : 'Add to Catalog'}
                    </button>
                  </td>
                </tr>
              ))}
              {filteredUncataloged.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <div className="empty-state">
                      <p className="empty-state-title">{productsLoading ? 'Loading inventory…' : 'Nothing left to add'}</p>
                      <p className="empty-state-desc">{productsLoading ? '' : 'Every part in Inventory already has a catalog draft.'}</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filteredUncataloged.length > 50 && (
          <p className="text-center" style={{ padding: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
            Showing the first 50 matches — refine your search to find a specific part.
          </p>
        )}
      </div>
    </div>
  );
}
