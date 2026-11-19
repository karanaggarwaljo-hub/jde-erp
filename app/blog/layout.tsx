import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Blog — Jai Durga Enterprises',
  description: 'Practical guides on backhoe loaders, rock breakers and excavators: maintenance, common problems and choosing the right parts.',
};

/** The public blog's frame: the same header and footer as the parts catalogue, with a way between
 *  the two, since a reader who has just learnt which part is worn will want to find it. */
export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ borderBottom: '1px solid var(--border-default)', padding: '18px 24px' }}>
        <div style={{ maxWidth: '1180px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <Link href="/blog" style={{ display: 'flex', alignItems: 'center', gap: '12px', textDecoration: 'none' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--brand-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: 'var(--ink)' }}>
              JDE
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '16px', color: 'var(--text-primary)' }}>Jai Durga Enterprises</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Machine care &amp; parts guides</div>
            </div>
          </Link>
          <nav aria-label="Website" style={{ marginLeft: 'auto', display: 'flex', gap: '18px', fontSize: '14px', fontWeight: 600 }}>
            <Link href="/blog" style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>Blog</Link>
            <Link href="/catalog" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Parts catalog</Link>
          </nav>
        </div>
      </header>
      <main style={{ flex: 1, maxWidth: '1180px', margin: '0 auto', padding: '32px 24px', width: '100%' }}>{children}</main>
      <footer style={{ borderTop: '1px solid var(--border-default)', padding: '18px 24px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
        © {new Date().getFullYear()} Jai Durga Enterprises. Guides are general advice: always follow your machine&apos;s own manual.
      </footer>
    </div>
  );
}
