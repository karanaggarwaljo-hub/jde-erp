import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Mail, Phone, PackageSearch } from 'lucide-react';
import { getCompanyPublicContact, getPublishedCatalogProduct } from '@/lib/db';

export const dynamic = 'force-dynamic';

const AVAILABILITY_LABEL: Record<string, string> = {
  in_stock: 'In Stock',
  out_of_stock: 'Out of Stock',
  contact_for_availability: 'Contact for Availability',
};

export default async function CatalogDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getPublishedCatalogProduct(id);
  if (!product) notFound();

  const companyId = product.company_id as string | undefined;
  const contact = companyId ? await getCompanyPublicContact(companyId) : undefined;
  const quoteSubject = encodeURIComponent(`Quote request: ${product.title} (${product.part_number || ''})`);
  const mailtoHref = contact?.contact_email ? `mailto:${contact.contact_email}?subject=${quoteSubject}` : null;

  return (
    <div>
      <Link href="/catalog" className="btn btn-ghost btn-sm mb-4"><ArrowLeft size={14} /> Back to Catalog</Link>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 380px) 1fr', gap: '32px' }}>
        <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--bg-input)' }}>
          {product.image_url ? (
            <Image src={String(product.image_url)} alt={String(product.title)} fill sizes="380px" style={{ objectFit: 'contain' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <PackageSearch size={48} color="var(--text-muted)" />
            </div>
          )}
        </div>

        <div>
          <span className="badge badge-info mb-2">{String(product.category || 'Parts')}</span>
          <h1 className="page-title">{String(product.title)}</h1>
          {product.brand ? <p style={{ color: 'var(--text-muted)', marginTop: '4px' }}>Brand: {String(product.brand)}</p> : null}

          <div className="flex gap-2 flex-wrap mt-4 mb-4">
            {product.part_number ? <span className="badge badge-muted">Part #: {String(product.part_number)}</span> : null}
            {product.oem_number ? <span className="badge badge-muted">OEM #: {String(product.oem_number)}</span> : null}
            <span className={`badge ${product.availability === 'in_stock' ? 'badge-success' : product.availability === 'out_of_stock' ? 'badge-danger' : 'badge-muted'}`}>
              {AVAILABILITY_LABEL[String(product.availability)] || 'Contact for Availability'}
            </span>
          </div>

          <div className="card card-sm mb-4">
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Price</span>
            <div style={{ fontSize: '24px', fontWeight: 800 }}>{product.price != null ? `₹${product.price}` : 'Request a Quote'}</div>
          </div>

          {product.compatibility ? (
            <div className="mb-4">
              <h3 className="card-title mb-2">Compatible Machines</h3>
              <p style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-line' }}>{String(product.compatibility)}</p>
            </div>
          ) : null}

          {product.description ? (
            <div className="mb-4">
              <h3 className="card-title mb-2">Description</h3>
              <p style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-line' }}>{String(product.description)}</p>
            </div>
          ) : null}

          {(mailtoHref || contact?.contact_phone) && (
            <div className="flex gap-2 flex-wrap mt-6">
              {mailtoHref && (
                <a href={mailtoHref} className="btn btn-primary"><Mail size={16} /> Request a Quote</a>
              )}
              {contact?.contact_phone && (
                <a href={`tel:${contact.contact_phone}`} className="btn btn-secondary"><Phone size={16} /> Call {contact.contact_phone}</a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
