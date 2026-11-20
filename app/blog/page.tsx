import Link from 'next/link';
import { Newspaper } from 'lucide-react';
import { listPublishedBlogPosts } from '@/lib/db';
import { MACHINES, isSafePhotoUrl, machineLabel, type PublicPhoto } from '@/lib/blog';
import { machineAndFormat } from '@/lib/blog-formats';

export const dynamic = 'force-dynamic';

const dateOf = (value: unknown): string => {
  const date = new Date(String(value ?? ''));
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
};

/** Every published post of the storefront company, newest first, grouped under a choice of machine. */
export default async function BlogListPage({ searchParams }: { searchParams: Promise<{ machine?: string }> }) {
  const { machine } = await searchParams;
  let posts: Array<Record<string, unknown>>;
  try {
    posts = await listPublishedBlogPosts();
  } catch (error) {
    // A visitor never sees a raw error; the cause is logged for diagnosis.
    console.error('BlogListPage failed to load:', error);
    return (
      <div className="empty-state">
        <Newspaper size={28} />
        <p className="empty-state-title">The blog is temporarily unavailable</p>
        <p className="empty-state-desc">Please check back soon.</p>
      </div>
    );
  }

  const chosen = MACHINES.some((entry) => entry.id === machine) ? machine : undefined;
  const shown = chosen ? posts.filter((post) => post.machine === chosen) : posts;
  const counts = new Map(MACHINES.map((entry) => [entry.id, posts.filter((post) => post.machine === entry.id).length]));

  return (
    <div className="blog-list">
      <h1 className="page-title">Machine care &amp; parts guides</h1>
      <p className="page-subtitle" style={{ marginBottom: '18px' }}>Practical advice on backhoe loaders, rock breakers and excavators, from people who supply their parts every day.</p>

      {posts.length > 0 && (
        <nav className="chip-row" aria-label="Machine" style={{ marginBottom: '20px' }}>
          <Link href="/blog" className={`chip${!chosen ? ' active' : ''}`}>All guides</Link>
          {MACHINES.filter((entry) => (counts.get(entry.id) ?? 0) > 0).map((entry) => (
            <Link key={entry.id} href={`/blog?machine=${entry.id}`} className={`chip${chosen === entry.id ? ' active' : ''}`}>{entry.label}</Link>
          ))}
        </nav>
      )}

      {shown.length === 0 ? (
        <div className="empty-state">
          <Newspaper size={28} />
          <p className="empty-state-title">No guides here yet</p>
          <p className="empty-state-desc">New guides are added regularly. Check back soon.</p>
        </div>
      ) : (
        <div className="blog-cards">
          {shown.map((post) => {
            const cover = post.cover && typeof post.cover === 'object' ? post.cover as PublicPhoto : null;
            return (
            <Link key={String(post.slug)} href={`/blog/${String(post.slug)}`} className={`blog-card${cover && isSafePhotoUrl(cover.url) ? ' has-cover' : ''}`}>
              {cover && isSafePhotoUrl(cover.url) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="blog-card-cover" src={cover.url} alt={cover.alt || String(post.title ?? '')} loading="lazy" />
              )}
              <span className="blog-card-machine">{machineAndFormat(machineLabel(String(post.machine ?? '')), post.format)}</span>
              <strong>{String(post.title ?? '')}</strong>
              {post.summary ? <span className="blog-card-summary">{String(post.summary)}</span> : null}
              <small>{dateOf(post.published_at)}</small>
            </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
