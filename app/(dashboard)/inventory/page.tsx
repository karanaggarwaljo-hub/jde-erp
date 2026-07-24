'use client';

import { useState } from 'react';
import { Package, Plus, Search, Filter, Edit, Trash2, Tag, AlertTriangle, CheckCircle, Eye } from 'lucide-react';

const initialProducts = [
  { id: '1', part_number: 'SP-001', oem_number: 'TOY-12345', name: 'Brake Pad Set - Front', brand: 'Bosch', category: 'Brakes', compatibility: 'Toyota Innova 2015-2023', cost_price: 850, mrp: 1200, sale_price: 1100, current_stock: 45, min_stock: 10, location: 'A-01' },
  { id: '2', part_number: 'SP-002', oem_number: 'HON-67890', name: 'Air Filter - Premium', brand: 'Denso', category: 'Filters', compatibility: 'Honda City 2018-2023', cost_price: 320, mrp: 650, sale_price: 580, current_stock: 78, min_stock: 15, location: 'B-03' },
  { id: '3', part_number: 'SP-003', oem_number: 'MAR-11111', name: 'Oil Filter', brand: 'Mann', category: 'Filters', compatibility: 'Maruti Suzuki Swift 2017-2023', cost_price: 180, mrp: 350, sale_price: 300, current_stock: 120, min_stock: 20, location: 'B-04' },
  { id: '4', part_number: 'SP-004', oem_number: 'TOY-22222', name: 'Clutch Plate', brand: 'LUK', category: 'Clutch', compatibility: 'Toyota Fortuner 2016-2023', cost_price: 2800, mrp: 4500, sale_price: 4200, current_stock: 8, min_stock: 5, location: 'C-02' },
  { id: '5', part_number: 'SP-005', oem_number: 'HON-33333', name: 'Spark Plug Set (4pcs)', brand: 'NGK', category: 'Engine', compatibility: 'Honda Jazz 2015-2023', cost_price: 650, mrp: 1100, sale_price: 980, current_stock: 35, min_stock: 10, location: 'D-01' },
  { id: '6', part_number: 'SP-006', oem_number: 'MAR-44444', name: 'Alternator Belt', brand: 'Gates', category: 'Engine', compatibility: 'Maruti Suzuki Baleno 2015-2023', cost_price: 290, mrp: 550, sale_price: 490, current_stock: 3, min_stock: 8, location: 'D-02' },
  { id: '7', part_number: 'SP-007', oem_number: 'HYU-55555', name: 'Shock Absorber - Rear', brand: 'Gabriel', category: 'Suspension', compatibility: 'Hyundai Creta 2018-2023', cost_price: 1850, mrp: 3200, sale_price: 2900, current_stock: 12, min_stock: 5, location: 'E-01' },
];

export default function InventoryPage() {
  const [products, setProducts] = useState(initialProducts);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);

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

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingProduct) {
      setProducts(products.map(p => p.id === editingProduct.id ? {
        ...p,
        ...formData,
        cost_price: Number(formData.cost_price),
        mrp: Number(formData.mrp),
        sale_price: Number(formData.sale_price),
        current_stock: Number(formData.current_stock),
        min_stock: Number(formData.min_stock),
      } : p));
    } else {
      const newP = {
        id: String(Date.now()),
        ...formData,
        cost_price: Number(formData.cost_price),
        mrp: Number(formData.mrp),
        sale_price: Number(formData.sale_price),
        current_stock: Number(formData.current_stock),
        min_stock: Number(formData.min_stock),
      };
      setProducts([newP, ...products]);
    }
    setShowModal(false);
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Spare Parts Inventory</h1>
          <p className="page-subtitle">Track stock levels, OEM cross-references, locations & pricing</p>
        </div>
        <button className="btn btn-primary" onClick={handleOpenAdd}>
          <Plus size={16} /> Add New Part
        </button>
      </div>

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
              <option value="Brakes">Brakes</option>
              <option value="Filters">Filters</option>
              <option value="Engine">Engine</option>
              <option value="Clutch">Clutch</option>
              <option value="Suspension">Suspension</option>
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
              <th>OEM Reference</th>
              <th>Item Name</th>
              <th>Brand & Category</th>
              <th>Compatibility</th>
              <th>Loc.</th>
              <th className="text-right">Cost</th>
              <th className="text-right">Sale Price</th>
              <th className="text-center">Stock Level</th>
              <th className="text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((p) => {
              const isLow = p.current_stock <= p.min_stock;
              return (
                <tr key={p.id}>
                  <td style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>{p.part_number}</td>
                  <td style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{p.oem_number || '-'}</td>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td>
                    <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{p.brand}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block' }}>{p.category}</span>
                  </td>
                  <td style={{ fontSize: '12px', color: 'var(--text-secondary)', maxWidth: '160px' }} className="truncate">
                    {p.compatibility}
                  </td>
                  <td style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{p.location}</td>
                  <td className="text-right" style={{ color: 'var(--text-muted)' }}>₹{p.cost_price}</td>
                  <td className="text-right font-semibold">₹{p.sale_price}</td>
                  <td className="text-center">
                    <span className={`badge ${isLow ? 'badge-danger' : 'badge-success'}`}>
                      {isLow && <AlertTriangle size={12} />}
                      {p.current_stock} Pcs
                    </span>
                  </td>
                  <td className="text-center">
                    <div className="flex justify-between gap-1 items-center">
                      <button className="btn btn-ghost btn-sm" onClick={() => { setEditingProduct(p); setFormData(p as any); setShowModal(true); }}>
                        <Edit size={14} />
                      </button>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
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
                    <select className="form-input form-select" value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })}>
                      <option value="Engine">Engine</option>
                      <option value="Brakes">Brakes</option>
                      <option value="Filters">Filters</option>
                      <option value="Clutch">Clutch</option>
                      <option value="Suspension">Suspension</option>
                      <option value="Electrical">Electrical</option>
                    </select>
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
    </div>
  );
}
