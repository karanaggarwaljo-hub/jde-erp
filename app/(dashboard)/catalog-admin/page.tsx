'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Globe, Plus, Search, ExternalLink, Copy, Check, Trash2, Inbox, RefreshCw } from 'lucide-react';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { catalogDisplayStatus, computeAvailabilityFromStock, type CatalogProduct } from '@/lib/catalogTypes';
import { firstUsefulTab, splitCatalog, type CatalogTab } from '@/lib/catalog-admin-filter';

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

// One list at a time. It used to be every catalog entry — live and draft mixed together — with
// every part not yet in the catalog stacked underneath, which the owner found too cluttered to use.
const TAB_TEXT: Record<CatalogTab, { label: string; title: string; help: string; search: string }> = {
  live: {
    label: 'Live on website',
    title: 'Live on your website',
    help: 'Customers can see these right now.',
    search: 'Search parts that are live…',
  },
  'not-live': {
    label: 'Not live',
    title: 'Not on your website',
    help: 'Started but not published, or taken down. Open one to finish it and publish it.',
    search: 'Search parts that are not live…',
  },
  'not-added': {
    label: 'Not added yet',
    title: 'Not in the catalog yet',
    help: 'Parts in Inventory with no website listing. Add one to start a draft.',
    search: 'Search parts not yet in the catalog…',
  },
};
const TAB_ORDER: CatalogTab[] = ['live', 'not-live', 'not-added'];

export default function CatalogAdminPage() {
  const router = useRouter();
  const { rows: products, loading: productsLoading } = useCompanyTable<Product>('products');
  const { rows: catalogRows, loading: catalogLoading, create, remove } = useCompanyTable<CatalogProduct>('catalog_products');
  const [search, setSearch] = useState('');
  // Null until the owner picks a tab; until then the screen opens on the first list with anything in it.
  const [chosenTab, setChosenTab] = useState<CatalogTab | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyLiveLink = async (id: string) => {
    const url = `${window.location.origin}/catalog/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000);
    } catch {
      setError(`Could not copy automatically — the link is ${url}`);
    }
  };

  const deleteCatalogRow = async (row: CatalogProduct) => {
    const liveWarning = row.publication_status === 'published' ? ' This is currently live on the public website.' : '';
    if (!confirm(`Delete "${row.title || 'this draft'}" from the Website Catalog?${liveWarning} This cannot be undone.`)) return;
    await remove(row.id);
  };

  const newestFirst = [...catalogRows].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  const everything = splitCatalog(newestFirst, products, '');
  const shown = splitCatalog(newestFirst, products, search);
  const tab: CatalogTab = chosenTab ?? (catalogLoading
    ? 'live'
    : firstUsefulTab({ live: everything.live.length, 'not-live': everything.notLive.length, 'not-added': everything.notAdded.length }));
  // Counts follow the search, so the number on a tab is always how many rows clicking it shows.
  const counts: Record<CatalogTab, number> = { live: shown.live.length, 'not-live': shown.notLive.length, 'not-added': shown.notAdded.length };
  const catalogList = tab === 'live' ? shown.live : shown.notLive;

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
        availability: computeAvailabilityFromStock(product.current_stock),
      });
      router.push(`/catalog-admin/${created.id}`);
    } catch {
      setError(`Couldn't create a catalog draft for ${product.name} — it may already have one.`);
    } finally {
      setAdding(null);
    }
  };

  const emptyText = (): { title: string; desc: string } => {
    if (search.trim()) return { title: 'Nothing matches your search', desc: 'Try another word, or check the other tabs.' };
    if (tab === 'live') return { title: catalogLoading ? 'Loading catalog…' : 'Nothing is live on your website yet', desc: 'Publish a draft from the Not live tab to put it on the website.' };
    if (tab === 'not-live') return { title: catalogLoading ? 'Loading catalog…' : 'Every catalog entry is live', desc: 'Nothing is waiting to be finished.' };
    return { title: productsLoading ? 'Loading inventory…' : 'Nothing left to add', desc: productsLoading ? '' : 'Every part in Inventory already has a catalog entry.' };
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Website Catalog</h1>
          <p className="page-subtitle">Turn approved Inventory parts into public website listings — nothing goes live until you publish it</p>
        </div>
        <div className="flex gap-2">
          <Link href="/catalog-admin/leads" className="btn btn-secondary">
            <Inbox size={16} /> Leads
          </Link>
          <Link href="/catalog-admin/recheck" className="btn btn-secondary">
            <RefreshCw size={16} /> Recheck Inventory
          </Link>
          <Link href="/catalog" target="_blank" className="btn btn-secondary" title="Preview only — this app's own catalog pages, not jd-enterprise.com. Not deployed anywhere public yet.">
            <ExternalLink size={16} /> Preview Catalog Pages
          </Link>
        </div>
      </div>

      {error && <div className="alert alert-danger mb-4" role="alert">{error}</div>}

      <div className="flex gap-2 mb-4" style={{ flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="tabs" role="group" aria-label="Show catalog parts by whether they are on the website">
          {TAB_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={tab === key}
              className={`tab${tab === key ? ' active' : ''}`}
              onClick={() => setChosenTab(key)}
            >
              {TAB_TEXT[key].label}<span className="tab-count">{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="search-bar" style={{ minWidth: '260px' }}>
          <Search className="search-bar-icon" size={16} />
          <input type="text" placeholder={TAB_TEXT[tab].search} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">{TAB_TEXT[tab].title}</h3>
            <p className="text-muted" style={{ fontSize: 13, marginTop: 2 }}>{TAB_TEXT[tab].help}</p>
          </div>
        </div>

        {tab !== 'not-added' ? (
          <div className="table-wrap catalog-table-scroll">
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
                {catalogList.map((row) => {
                  const status = catalogDisplayStatus(row);
                  return (
                    <tr key={row.id}>
                      <td style={{ fontWeight: 600 }}>{row.title || '(untitled)'}</td>
                      <td><span style={{ fontFamily: 'monospace' }}>{row.part_number || '-'}</span></td>
                      <td>{row.category ? <span className="badge badge-info">{row.category}</span> : '-'}</td>
                      <td className="text-center"><span className={`badge ${status.cls}`}>{status.label}</span></td>
                      <td className="text-center">
                        <div className="flex gap-1 justify-center">
                          <Link href={`/catalog-admin/${row.id}`} className="btn btn-ghost btn-sm">Open</Link>
                          {row.publication_status === 'published' && (
                            <>
                              <Link href={`/catalog/${row.id}`} target="_blank" className="btn btn-ghost btn-sm" title="Open the live website page">
                                <ExternalLink size={14} /> View Live
                              </Link>
                              <button className="btn btn-ghost btn-sm" title="Copy the website link" onClick={() => copyLiveLink(row.id)}>
                                {copiedId === row.id ? <Check size={14} /> : <Copy size={14} />}
                              </button>
                            </>
                          )}
                          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} title="Delete" aria-label={`Delete ${row.title || 'this draft'}`} onClick={() => deleteCatalogRow(row)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {catalogList.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <div className="empty-state">
                        <Globe size={24} />
                        <p className="empty-state-title">{emptyText().title}</p>
                        <p className="empty-state-desc">{emptyText().desc}</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <div className="table-wrap catalog-table-scroll">
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
                  {shown.notAdded.map((p) => (
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
                  {shown.notAdded.length === 0 && (
                    <tr>
                      <td colSpan={4}>
                        <div className="empty-state">
                          <p className="empty-state-title">{emptyText().title}</p>
                          <p className="empty-state-desc">{emptyText().desc}</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
