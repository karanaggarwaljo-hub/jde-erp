'use client';

import { ChangeEvent, useState } from 'react';
import { Plus, Search, Filter, Edit, Trash2, AlertTriangle, Upload } from 'lucide-react';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { parseInventoryFile } from '@/lib/client-import';
import { addStockLayer, consumeStockFifo } from '@/lib/client-fifo';

type Product = {
  id: string;
  company_id: string;
  part_number: string;
  oem_number: string;
  name: string;
  brand: string;
  category: string;
  compatibility: string;
  cost_price: number;
  mrp: number;
  sale_price: number;
  current_stock: number;
  min_stock: number;
  location: string;
};

type StockLayer = { id: string; product_id: string; unit_cost: number; qty_remaining: number; created_at: string };

const DEFAULT_CATEGORIES = ['Engine', 'Brakes', 'Filters', 'Clutch', 'Suspension', 'Electrical'];

export default function InventoryPage() {
  const { rows: products, loading, create, update, remove, reload, activeCompany } = useCompanyTable<Product>('products');
  const { rows: stockLayers } = useCompanyTable<StockLayer>('stock_layers');

  // Cost price shown per product = the oldest FIFO batch that still has stock left (i.e. what the
  // next sale will actually cost), falling back to the static cost_price field when a product has
  // no batches at all (e.g. it's never been purchased through the FIFO-tracked flow).
  const oldestOpenLayerByProduct = new Map<string, StockLayer>();
  for (const layer of stockLayers) {
    if (Number(layer.qty_remaining) <= 0) continue;
    const current = oldestOpenLayerByProduct.get(layer.product_id);
    if (!current || new Date(layer.created_at).getTime() < new Date(current.created_at).getTime()) {
      oldestOpenLayerByProduct.set(layer.product_id, layer);
    }
  }
  const fifoCostFor = (product: Product) => Number(oldestOpenLayerByProduct.get(product.id)?.unit_cost ?? product.cost_price);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Product | null>(null);
  const [feedback, setFeedback] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');

  const [formData, setFormData] = useState({
    part_number: '',
    oem_number: '',
    name: '',
    brand: '',
    category: '',
    compatibility: '',
    cost_price: '',
    mrp: '',
    sale_price: '',
    current_stock: '',
    min_stock: '',
    location: '',
  });

  const categoryOptions = Array.from(new Set([...DEFAULT_CATEGORIES, ...products.map((p) => p.category).filter(Boolean)])).sort();

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.part_number.toLowerCase().includes(search.toLowerCase()) ||
      p.oem_number.toLowerCase().includes(search.toLowerCase()) ||
      p.brand.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const handleOpenAdd = () => {
    setEditingProduct(null);
    setFormData({
      part_number: `SP-00${products.length + 1}`,
      oem_number: '',
      name: '',
      brand: '',
      category: 'Engine',
      compatibility: '',
      cost_price: '',
      mrp: '',
      sale_price: '',
      current_stock: '',
      min_stock: '10',
      location: 'A-01',
    });
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const newCostPrice = Number(formData.cost_price);
    const newStock = Number(formData.current_stock);
    const payload = {
      ...formData,
      cost_price: newCostPrice,
      mrp: Number(formData.mrp),
      sale_price: Number(formData.sale_price),
      current_stock: newStock,
      min_stock: Number(formData.min_stock),
    };
    if (editingProduct) {
      // current_stock is owned by the FIFO calls below, not this PATCH — writing it here too
      // would double-count. A stock-unchanged edit (e.g. fixing a typo'd sale price) correctly
      // touches only the static fields and opens no new batch.
      const patch: Record<string, unknown> = { ...payload };
      delete patch.current_stock;
      await update(editingProduct.id, patch);
      const delta = newStock - Number(editingProduct.current_stock);
      if (delta > 0) {
        await addStockLayer(editingProduct.id, delta, newCostPrice, null, true);
      } else if (delta < 0) {
        await consumeStockFifo(editingProduct.id, -delta, null);
      }
    } else {
      const created = await create(payload);
      if (newStock > 0) {
        // adjustStock=false: current_stock was already set by the insert above, so this only
        // opens the matching opening batch without bumping stock a second time.
        await addStockLayer(created.id, newStock, newCostPrice, null, false);
      }
    }
    setShowModal(false);
    setFeedback(editingProduct ? 'Part updated successfully.' : 'New part added to inventory.');
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      part_number: product.part_number,
      oem_number: product.oem_number,
      name: product.name,
      brand: product.brand,
      category: product.category,
      compatibility: product.compatibility,
      cost_price: String(product.cost_price),
      mrp: String(product.mrp),
      sale_price: String(product.sale_price),
      current_stock: String(product.current_stock),
      min_stock: String(product.min_stock),
      location: product.location,
    });
    setShowModal(true);
  };

  const confirmDelete = async () => {
    if (!deleteCandidate) return;
    await remove(deleteCandidate.id);
    setFeedback(`${deleteCandidate.part_number} removed from inventory.`);
    setDeleteCandidate(null);
  };

  const handleFileImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportError('');
    setFeedback('');
    setImporting(true);
    try {
      const { products: imported, guessedFields } = await parseInventoryFile(file);
      if (imported.length === 0) {
        throw new Error('Couldn’t find a part name/description column in this file. Recognized headers include things like "Name", "Item Name", "Description", or "Part Number" — check your column titles, or share them and we can adjust the import.');
      }
      for (const product of imported) {
        await fetch('/api/local/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...product, company_id: activeCompany?.id }),
        });
      }
      await reload();
      const guessNote = guessedFields.length > 0
        ? ` Your file's column titles didn't clearly label ${guessedFields.join(', ')}, so those were guessed from the numbers — please spot-check a few rows.`
        : '';
      setFeedback(`Imported ${imported.length} part(s) from ${file.name}.${guessNote}`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to read the file.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Spare Parts Inventory</h1>
          <p className="page-subtitle">Track stock levels, OEM cross-references, locations & pricing</p>
        </div>
        <div className="flex gap-2">
          <label className="btn btn-secondary" style={{ cursor: importing ? 'not-allowed' : 'pointer' }}>
            <Upload size={16} /> {importing ? 'Importing…' : 'Import from File'}
            <input type="file" accept=".csv,.xls,.xlsx" hidden disabled={importing} onChange={handleFileImport} />
          </label>
          <button className="btn btn-primary" onClick={handleOpenAdd}>
            <Plus size={16} /> Add New Part
          </button>
        </div>
      </div>

      {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}
      {importError && <div className="alert alert-danger mb-4" role="alert">{importError}</div>}

      {/* Filter & Search Bar */}
      <div className="card mb-6 p-4">
        <div className="flex gap-4 items-center flex-wrap">
          <div className="search-bar" style={{ flex: 1, minWidth: '240px' }}>
            <Search className="search-bar-icon" size={16} />
            <input
              type="text"
              placeholder="Search by Part #, OEM #, Description, Brand..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Filter size={16} color="var(--text-muted)" />
            <select
              className="form-input form-select"
              style={{ width: '160px' }}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="all">All Categories</option>
              {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Product Table */}
      <div className="table-wrap">
        <table className="erp-table">
          <thead>
            <tr>
              <th>Part Number</th>
              <th>Item Name</th>
              <th>Brand</th>
              <th>Category</th>
              <th className="text-right">Price</th>
              <th className="text-right">Margin</th>
              <th className="text-center">Stock Level</th>
              <th className="text-center">Status</th>
              <th className="text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((p) => {
              const isLow = p.min_stock > 0 && p.current_stock <= p.min_stock;
              const isOut = p.current_stock <= 0;
              const fifoCost = fifoCostFor(p);
              const margin = p.sale_price > 0 ? ((p.sale_price - fifoCost) / p.sale_price) * 100 : 0;
              const status = isOut ? 'Out of Stock' : isLow ? 'Low Stock' : 'In Stock';
              const statusBadge = isOut ? 'badge-danger' : isLow ? 'badge-warning' : 'badge-success';
              return (
                <tr key={p.id}>
                  <td>
                    <span style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>{p.part_number}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace', display: 'block' }}>{p.oem_number || '-'}</span>
                  </td>
                  <td style={{ fontWeight: 600, maxWidth: '150px' }} className="truncate">{p.name}</td>
                  <td style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{p.brand}</td>
                  <td><span className="badge badge-info">{p.category}</span></td>
                  <td className="text-right">
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block' }}>₹{fifoCost}</span>
                    <span className="font-semibold">₹{p.sale_price}</span>
                  </td>
                  <td className="text-right">
                    <span className={margin >= 0 ? 'text-success font-semibold' : 'text-danger font-semibold'}>{margin.toFixed(1)}%</span>
                  </td>
                  <td className="text-center">
                    <span className={`badge ${isLow ? 'badge-danger' : 'badge-success'}`}>
                      {isLow && <AlertTriangle size={12} />}
                      {p.current_stock} Pcs
                    </span>
                  </td>
                  <td className="text-center">
                    <span className={`badge ${statusBadge}`}>{status}</span>
                  </td>
                  <td className="text-center">
                    <div className="flex justify-between gap-1 items-center">
                      <button className="btn btn-ghost btn-sm" aria-label={`Edit ${p.name}`} onClick={() => handleEdit(p)}>
                        <Edit size={14} />
                      </button>
                      <button className="btn btn-ghost btn-sm" aria-label={`Delete ${p.name}`} style={{ color: 'var(--color-danger)' }} onClick={() => setDeleteCandidate(p)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredProducts.length === 0 && (
              <tr><td colSpan={9}><div className="empty-state"><AlertTriangle size={24} /><p className="empty-state-title">{loading ? 'Loading inventory…' : 'No parts found'}</p><p className="empty-state-desc">{loading ? 'Fetching parts for the active company.' : 'Try another search term or category, or this company simply has no parts yet.'}</p></div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Product Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header">
              <h3 className="modal-title">{editingProduct ? 'Edit Spare Part' : 'Add New Spare Part'}</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body flex flex-col gap-4">
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">Part Number *</label>
                    <input className="form-input" required value={formData.part_number} onChange={e => setFormData({ ...formData, part_number: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">OEM Number</label>
                    <input className="form-input" value={formData.oem_number} onChange={e => setFormData({ ...formData, oem_number: e.target.value })} />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Part Name / Description *</label>
                  <input className="form-input" required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                </div>

                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">Brand</label>
                    <input className="form-input" value={formData.brand} onChange={e => setFormData({ ...formData, brand: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Category</label>
                    <input
                      className="form-input"
                      list="category-options"
                      placeholder="Pick or type a new category"
                      value={formData.category}
                      onChange={e => setFormData({ ...formData, category: e.target.value })}
                    />
                    <datalist id="category-options">
                      {categoryOptions.map((category) => <option key={category} value={category} />)}
                    </datalist>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Compatibility (Vehicle Models)</label>
                  <input className="form-input" placeholder="e.g. Toyota Innova 2015-2023" value={formData.compatibility} onChange={e => setFormData({ ...formData, compatibility: e.target.value })} />
                </div>

                <div className="form-grid-3">
                  <div className="form-group">
                    <label className="form-label">Cost Price (₹)</label>
                    <input type="number" className="form-input" value={formData.cost_price} onChange={e => setFormData({ ...formData, cost_price: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">MRP (₹)</label>
                    <input type="number" className="form-input" value={formData.mrp} onChange={e => setFormData({ ...formData, mrp: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Sale Price (₹) *</label>
                    <input type="number" className="form-input" required value={formData.sale_price} onChange={e => setFormData({ ...formData, sale_price: e.target.value })} />
                  </div>
                </div>

                <div className="form-grid-3">
                  <div className="form-group">
                    <label className="form-label">Initial Stock</label>
                    <input type="number" className="form-input" value={formData.current_stock} onChange={e => setFormData({ ...formData, current_stock: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Min Stock Threshold</label>
                    <input type="number" className="form-input" value={formData.min_stock} onChange={e => setFormData({ ...formData, min_stock: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Rack Location</label>
                    <input className="form-input" placeholder="e.g. A-01" value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })} />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Product</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteCandidate && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: '440px' }} role="dialog" aria-modal="true" aria-labelledby="delete-part-title">
            <div className="modal-header"><h3 id="delete-part-title" className="modal-title">Delete inventory part?</h3></div>
            <div className="modal-body">
              <p>This will remove <strong>{deleteCandidate.part_number} — {deleteCandidate.name}</strong> from the current inventory list.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteCandidate(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmDelete}>Delete Part</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
