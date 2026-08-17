import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { Metadata } from 'next';
import { ArrowLeft, Mail, MessageCircle, Phone, PackageSearch } from 'lucide-react';
import { getCompanyPublicContact, getPublishedCatalogProduct, logCatalogEvent } from '@/lib/db';
import RfqForm from '../RfqForm';

export const dynamic = 'force-dynamic';

const AVAILABILITY_LABEL: Record<string, string> = {
  in_stock: 'In Stock',
  out_of_stock: 'Out of Stock',
  contact_for_availability: 'Contact for Availability',
};

/** React.cache dedupes this per request, so generateMetadata and the page component below share
 *  one DB round trip instead of two (both call getProduct with the same id during the same
 *  request). Scoped to this module only — lib/db/index.ts itself is owned by another agent's
 *  work in this PRD, so this wraps the import locally rather than changing the export. */
const getProduct = cache(getPublishedCatalogProduct);

/** Same digit-stripping + wa.me builder as CatalogBrowser.tsx's buildWhatsAppUrl — duplicated
 *  rather than imported because this file is a Server Component and CatalogBrowser.tsx is a
 *  'use client' module: a plain function exported from a client module becomes an uncallable
 *  client reference when pulled into server-rendered code (only usable as JSX, not invoked
 *  directly), so it can't be reused here. Keep both copies in sync if this logic ever changes. */
function buildWhatsAppUrl(phone: string | null | undefined, message: string): string | null {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  let product: Record<string, unknown> | undefined;
  try {
    product = await getProduct(id);
  } catch (error) {
    // Metadata generation runs as part of the same request as the page component below — if
    // Supabase is unreachable here too, fall back to a generic title instead of letting this
    // throw take down the whole route before the page's own try/catch gets a chance to render
    // its friendly fallback.
    console.error('generateMetadata: failed to load catalog product:', error);
    return { title: 'Spare Parts Catalog — Jai Durga Enterprises' };
  }
  if (!product) {
    return { title: 'Part Not Found — Jai Durga Enterprises' };
  }

  const title = `${String(product.title)}${product.part_number ? ` (Part #${product.part_number})` : ''} — Jai Durga Enterprises`;
  const description = (
    String(product.description || '').trim() ||
    `${String(product.title)} — genuine spare part available from Jai Durga Enterprises.${product.compatibility ? ` Compatible with: ${product.compatibility}.` : ''}`
  ).slice(0, 200);

  // WhatsApp (and other chat apps) need openGraph tags to render a link preview card instead of
  // a bare URL — worth setting since customers will plausibly share catalog links to each other.
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: product.image_url ? [String(product.image_url)] : undefined,
    },
  };
}

export default async function CatalogDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let product: Record<string, unknown> | undefined;
  try {
    product = await getProduct(id);
  } catch (error) {
    // Anonymous public visitors must never see a raw framework 500 page or a leaked Supabase
    // error message — log the real cause server-side for diagnosis, and show the same friendly
    // empty-state visual the list page uses for its zero-products case, just with different copy
    // so it reads as "come back later" rather than "there's nothing here". Deliberately outside
    // the notFound() call below: notFound() throws its own special error for Next's own routing
    // machinery to catch, which must never be swallowed by this catch block.
    console.error('CatalogDetailPage failed to load product:', error);
    return (
      <div className="empty-state">
        <PackageSearch size={28} />
        <p className="empty-state-title">Catalog temporarily unavailable</p>
        <p className="empty-state-desc">Please check back soon.</p>
      </div>
    );
  }
  if (!product) notFound();

  // The product has already loaded (and notFound() already had its chance to fire above) — a
  // logging failure from here on must never take the page down with it.
  try {
    await logCatalogEvent({ eventType: 'view', catalogProductId: id });
  } catch (err) {
    console.error('logCatalogEvent(view) failed:', err);
  }

  const companyId = product.company_id as string | undefined;
  let contact: { contact_email: string | null; contact_phone: string | null } | undefined;
  try {
    contact = companyId ? await getCompanyPublicContact(companyId) : undefined;
  } catch (error) {
    // Same isolation principle as logCatalogEvent above: contact info only gates the
    // Request-a-Quote / WhatsApp / Call buttons further down, not the reason this page exists —
    // a failure here shouldn't discard the part details that already loaded fine.
    console.error('CatalogDetailPage failed to load company contact:', error);
    contact = undefined;
  }
  const quoteSubject = encodeURIComponent(`Quote request: ${product.title} (${product.part_number || ''})`);
  const mailtoHref = contact?.contact_email ? `mailto:${contact.contact_email}?subject=${quoteSubject}` : null;
  const waHref = buildWhatsAppUrl(
    contact?.contact_phone,
    `Hi, I'd like to request a quote for: ${product.title} (Part #: ${product.part_number || 'N/A'}). Is this available?`
  );

  const breadcrumbItems: Array<{ label: string; href?: string }> = [{ label: 'Home', href: '/catalog' }];
  if (product.brand) {
    breadcrumbItems.push({ label: String(product.brand), href: `/catalog?brand=${encodeURIComponent(String(product.brand))}` });
  }
  if (product.category) {
    const categoryParams = new URLSearchParams();
    if (product.brand) categoryParams.set('brand', String(product.brand));
    categoryParams.set('category', String(product.category));
    breadcrumbItems.push({ label: String(product.category), href: `/catalog?${categoryParams.toString()}` });
  }
  breadcrumbItems.push({ label: String(product.title) });

  return (
    <div>
      <nav aria-label="Breadcrumb" style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
        {breadcrumbItems.map((item, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            {i > 0 && <span>›</span>}
            {item.href ? <Link href={item.href} style={{ color: 'var(--text-muted)' }}>{item.label}</Link> : <span style={{ color: 'var(--text-primary)' }}>{item.label}</span>}
          </span>
        ))}
      </nav>
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

          <div className="flex gap-2 flex-wrap mt-4 mb-2 items-center">
            {product.part_number ? <span className="badge badge-muted">Part #: {String(product.part_number)}</span> : null}
            {product.oem_number ? <span className="badge badge-muted">OEM #: {String(product.oem_number)}</span> : null}
            <span className={`badge ${product.availability === 'in_stock' ? 'badge-success' : product.availability === 'out_of_stock' ? 'badge-danger' : 'badge-muted'}`}>
              {AVAILABILITY_LABEL[String(product.availability)] || 'Contact for Availability'}
            </span>
          </div>
          {product.published_at ? (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
              Last confirmed: {new Date(String(product.published_at)).toLocaleDateString()}
            </p>
          ) : null}

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

          {(mailtoHref || contact?.contact_phone || waHref) && (
            <div className="flex gap-2 flex-wrap mt-6">
              {mailtoHref && (
                <a href={mailtoHref} className="btn btn-primary"><Mail size={16} /> Request a Quote</a>
              )}
              {waHref && (
                <a href={waHref} target="_blank" rel="noreferrer" className="btn btn-secondary"><MessageCircle size={16} /> WhatsApp Quote</a>
              )}
              {contact?.contact_phone && (
                <a href={`tel:${contact.contact_phone}`} className="btn btn-secondary"><Phone size={16} /> Call {contact.contact_phone}</a>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-8">
        <RfqForm
          catalogProductId={String(product.id)}
          partTitle={String(product.title)}
          partNumber={String(product.part_number || '')}
          contactPhone={contact?.contact_phone ?? null}
        />
      </div>
    </div>
  );
}
