'use client';

import { ChangeEvent, useState } from 'react';
import { Plus, Search, Filter, Edit, Trash2, AlertTriangle, Upload, Sparkles } from 'lucide-react';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { useCompany } from '@/components/CompanyProvider';
import { parseInventoryFile } from '@/lib/client-import';
import { addStockLayer, consumeStockFifo, correctOldestLayerCost } from '@/lib/client-fifo';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';

type Product = {
  id: string;
  company_id: string;
  part_number: string;
  oem_number: string;
  hsn_code: string;
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
  const { configError } = useCompany();
  const { rows: products, loading, create, update, remove, reload, activeCompany } = useCompanyTable<Product>('products');
  const { rows: stockLayers, reload: reloadStockLayers } = useCompanyTable<StockLayer>('stock_layers');

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
  const [suggesting, setSuggesting] = useState(false);
  const [suggestFailed, setSuggestFailed] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [formData, setFormData] = useState({
    part_number: '',
    oem_number: '',
    hsn_code: '',
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

  // Warns before creating a likely-accidental duplicate (e.g. re-adding a part because a previous
  // save gave no visible confirmation) without blocking a genuinely intentional re-add — same name,
  // case-insensitive, only checked while adding a brand-new part, never while editing one.
  const possibleDuplicate = !editingProduct && formData.name.trim()
    ? products.find((p) => p.name.trim().toLowerCase() === formData.name.trim().toLowerCase())
    : undefined;

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.part_number.toLowerCase().includes(search.toLowerCase()) ||
      p.oem_number.toLowerCase().includes(search.toLowerCase()) ||
      p.brand.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const suggestPartDetails = async () => {
    if (!formData.name.trim()) return;
    setSuggesting(true);
    setSuggestFailed(false);
    try {
      const res = await fetch('/api/ai-suggest-part-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formData.name, oem_number: formData.oem_number, existingCategories: categoryOptions }),
      });
      const body = (await parseJsonOrThrow(res, 'Suggestion failed.')) as { category?: string; brand?: string };
      setFormData((current) => ({
        ...current,
        category: body.category || current.category,
        brand: !current.brand && body.brand ? body.brand : current.brand,
      }));
    } catch {
      // Suggestion is a convenience, not required — both fields stay freely editable either way.
      // Still worth a quiet heads-up though: silently doing nothing looks identical to "broken."
      setSuggestFailed(true);
    } finally {
      setSuggesting(false);
    }
  };

  const handleOpenAdd = () => {
    setEditingProduct(null);
    setSaveError('');
    setSuggestFailed(false);
    setFormData({
      part_number: `SP-00${products.length + 1}`,
      oem_number: '',
      hsn_code: '',
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
    setSaveError('');
    setSavingProduct(true);
    try {
      const newCostPrice = Number(formData.cost_price);
      const newStock = Number(formData.current_stock);
      if (!editingProduct && newStock <= 0) {
        throw new Error('Initial stock must be greater than 0 for a new part — enter the quantity you actually have on hand.');
      }
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
        } else if (newCostPrice !== Number(editingProduct.cost_price)) {
          // Stock didn't change, only the cost figure did — correct the batch the display is
          // currently reading from instead of silently leaving it stale (the bug that made typing
          // a new cost price not actually change the shown cost/margin).
          await correctOldestLayerCost(editingProduct.id, newCostPrice);
        }
      } else {
        const created = await create(payload);
        if (newStock > 0) {
          // adjustStock=false: current_stock was already set by the insert above, so this only
          // opens the matching opening batch without bumping stock a second time.
          await addStockLayer(created.id, newStock, newCostPrice, null, false);
        }
      }
      // Same class of bug, two different tables: update()/create() above reload `products`, but
      // both run *before* addStockLayer/consumeStockFifo — which are what actually change
      // current_stock in the database (deliberately excluded from the plain PATCH above, see its
      // own comment) — so that first reload always captures the pre-change stock, and nothing
      // reloaded `products` again afterward. Changing Initial Stock on an existing part, or the
      // opening stock on a new one, genuinely saved every time; the Stock Level column just kept
      // showing the old number until a full page reload. Reloading both tables here, after
      // everything above has actually finished, is what makes the screen match the database.
      await Promise.all([reload(), reloadStockLayers()]);
      setShowModal(false);
      setFeedback(editingProduct ? 'Part updated successfully.' : 'New part added to inventory.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save this part — please try again.');
    } finally {
      setSavingProduct(false);
    }
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setSaveError('');
    setSuggestFailed(false);
    setFormData({
      part_number: product.part_number,
      oem_number: product.oem_number,
      hsn_code: product.hsn_code || '',
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

      {configError && (
        <div className="alert alert-danger mb-4" role="alert">
          Can&apos;t reach the database right now — {configError}
        </div>
      )}

      {!configError && (
      <>
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
              <th>OEM Number</th>
              <th>HSN Code</th>
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
                  </td>
                  <td style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{p.oem_number || '-'}</td>
                  <td style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{p.hsn_code || '-'}</td>
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
              <tr><td colSpan={11}><div className="empty-state"><AlertTriangle size={24} /><p className="empty-state-title">{loading ? 'Loading inventory…' : 'No parts found'}</p><p className="empty-state-desc">{loading ? 'Fetching parts for the active company.' : 'Try another search term or category, or this company simply has no parts yet.'}</p></div></td></tr>
            )}
          </tbody>
        </table>
      </div>
      </>
      )}

      {/* Add / Edit Product Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header">
              <h3 className="modal-title">{editingProduct ? 'Edit Spare Part' : 'Add New Spare Part'}</h3>
              <button className="btn btn-ghost btn-sm" disabled={savingProduct} onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body flex flex-col gap-4">
                {saveError && <div className="alert alert-danger" role="alert">{saveError}</div>}
                {possibleDuplicate && (
                  <div className="alert alert-warning" role="alert">
                    A part named &quot;{possibleDuplicate.name}&quot; already exists ({possibleDuplicate.part_number}, {possibleDuplicate.current_stock} in stock) — this will add a separate, second entry rather than update it. If you meant to edit the existing one, cancel and use its Edit button instead.
                  </div>
                )}
                <div className="form-grid-3">
                  <div className="form-group">
                    <label className="form-label">Part Number *</label>
                    <input className="form-input" required value={formData.part_number} onChange={e => setFormData({ ...formData, part_number: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">OEM Number</label>
                    <input className="form-input" value={formData.oem_number} onChange={e => setFormData({ ...formData, oem_number: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">HSN Code</label>
                    <input className="form-input" placeholder="e.g. 84314990" value={formData.hsn_code} onChange={e => setFormData({ ...formData, hsn_code: e.target.value })} />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Part Name / Description *</label>
                  <input className="form-input" required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} onBlur={suggestPartDetails} />
                  <small style={{ color: 'var(--text-muted)' }}>{suggestFailed ? "Couldn't get a suggestion this time — go ahead and fill these in yourself." : 'Brand and category are suggested once you finish typing this — override either anytime.'}</small>
                </div>

                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label flex items-center gap-1">Brand {suggesting && <Sparkles size={12} className="text-brand spin" />}</label>
                    <input className="form-input" value={formData.brand} onChange={e => setFormData({ ...formData, brand: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label flex items-center gap-1">Category {suggesting && <Sparkles size={12} className="text-brand spin" />}</label>
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
                    <label className="form-label">Initial Stock{!editingProduct && ' *'}</label>
                    <input type="number" className="form-input" min={editingProduct ? 0 : 1} required={!editingProduct} value={formData.current_stock} onChange={e => setFormData({ ...formData, current_stock: e.target.value })} />
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
                <button type="button" className="btn btn-secondary" disabled={savingProduct} onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={savingProduct}>{savingProduct ? 'Saving…' : 'Save Product'}</button>
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
