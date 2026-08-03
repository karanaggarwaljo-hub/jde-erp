import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Parts Catalog — Jai Durga Enterprises',
  description: 'Browse genuine and quality-checked spare parts from Jai Durga Enterprises.',
};

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ borderBottom: '1px solid var(--border-default)', padding: '18px 24px' }}>
        <div style={{ maxWidth: '1180px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link href="/catalog" style={{ display: 'flex', alignItems: 'center', gap: '12px', textDecoration: 'none' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'linear-gradient(135deg, #F59E0B, #F97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#000' }}>
              JDE
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '16px', color: 'var(--text-primary)' }}>Jai Durga Enterprises</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Spare Parts Catalog</div>
            </div>
          </Link>
        </div>
      </header>
      <main style={{ flex: 1, maxWidth: '1180px', margin: '0 auto', padding: '32px 24px', width: '100%' }}>{children}</main>
      <footer style={{ borderTop: '1px solid var(--border-default)', padding: '18px 24px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
        © {new Date().getFullYear()} Jai Durga Enterprises. Prices and availability are subject to confirmation.
      </footer>
    </div>
  );
}
