'use client';

import Link from 'next/link';
import { ArrowLeft, Inbox } from 'lucide-react';
import { useCompanyTable } from '@/lib/useCompanyTable';

type Lead = {
  id: string;
  catalog_product_id: string;
  part_title: string;
  part_number: string;
  customer_name: string;
  customer_phone: string;
  quantity: number | null;
  machine_model: string | null;
  message: string | null;
  status: 'new' | 'contacted' | 'closed';
  created_at: string;
};

const STATUS_OPTIONS: Array<{ value: Lead['status']; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'closed', label: 'Closed' },
];

export default function CatalogLeadsPage() {
  const { rows: leads, loading, update } = useCompanyTable<Lead>('catalog_leads');

  const sortedLeads = [...leads].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return (
    <div>
      <div className="page-header">
        <div>
          <Link href="/catalog-admin" className="btn btn-ghost btn-sm mb-2"><ArrowLeft size={14} /> Back to Website Catalog</Link>
          <h1 className="page-title">Quote Requests</h1>
          <p className="page-subtitle">Customer &quot;Request a Quote&quot; submissions from the public Website Catalog</p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Requests</h3>
        </div>
        <div className="table-wrap">
          <table className="erp-table">
            <thead>
              <tr>
                <th>Submitted</th>
                <th>Customer</th>
                <th>Part</th>
                <th className="text-center">Qty</th>
                <th>Machine Model</th>
                <th>Message</th>
                <th className="text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedLeads.map((lead) => (
                <tr key={lead.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(lead.created_at).toLocaleString()}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{lead.customer_name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{lead.customer_phone}</div>
                  </td>
                  <td>
                    <Link href={`/catalog-admin/${lead.catalog_product_id}`} style={{ fontWeight: 600, color: 'var(--brand-primary)' }}>{lead.part_title}</Link>
                    <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-muted)' }}>{lead.part_number}</div>
                  </td>
                  <td className="text-center">{lead.quantity ?? '-'}</td>
                  <td>{lead.machine_model || '-'}</td>
                  <td style={{ maxWidth: '260px', whiteSpace: 'pre-wrap' }}>{lead.message || '-'}</td>
                  <td className="text-center">
                    <select
                      className="form-input form-select"
                      value={lead.status}
                      onChange={(e) => update(lead.id, { status: e.target.value })}
                    >
                      {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {sortedLeads.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      <Inbox size={24} />
                      <p className="empty-state-title">{loading ? 'Loading quote requests…' : 'No quote requests yet'}</p>
                      <p className="empty-state-desc">{loading ? '' : 'Submissions from the public Website Catalog\'s Request a Quote form will show up here.'}</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
