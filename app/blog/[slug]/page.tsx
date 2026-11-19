import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { Metadata } from 'next';
import { ArrowLeft, Newspaper, Phone, PackageSearch } from 'lucide-react';
import BlogBody from '@/components/blog/BlogBody';
import { getCompanyPublicContact, getPublishedBlogPost, getStorefrontCompanyId } from '@/lib/db';
import { isSafePhotoUrl, machineLabel, readMinutes, type FaqItem, type PublicPhoto } from '@/lib/blog';

export const dynamic = 'force-dynamic';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://jd-enterprise.com').replace(/\/$/, '');

/** One database read per request, shared by the metadata and the page. */
const getPost = cache(getPublishedBlogPost);

const faqOf = (value: unknown): FaqItem[] =>
  (Array.isArray(value) ? value : [])
    .map((item) => (item && typeof item === 'object' ? item as Record<string, unknown> : {}))
    .map((item) => ({ question: String(item.question ?? ''), answer: String(item.answer ?? '') }))
    .filter((item) => item.question && item.answer);

/** The cover photo, when there is one with a safe address. */
const coverOf = (value: unknown): PublicPhoto | null => {
  const cover = value && typeof value === 'object' ? value as PublicPhoto : null;
  return cover && isSafePhotoUrl(cover.url) ? cover : null;
};

const dateOf = (value: unknown): string => {
  const date = new Date(String(value ?? ''));
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  let post: Record<string, unknown> | undefined;
  try {
    post = await getPost(slug);
  } catch (error) {
    console.error('generateMetadata: failed to load blog post:', error);
    return { title: 'Blog — Jai Durga Enterprises' };
  }
  if (!post) return { title: 'Guide not found — Jai Durga Enterprises' };
  const title = `${String(post.title)} — Jai Durga Enterprises`;
  const description = String(post.summary ?? '').slice(0, 200);
  const cover = coverOf(post.cover);
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/blog/${slug}` },
    // A link shared on WhatsApp shows a card, with the cover photo when there is one.
    openGraph: {
      title: String(post.title),
      description,
      type: 'article',
      publishedTime: String(post.published_at ?? '') || undefined,
      images: cover ? [{ url: cover.url, alt: cover.alt || String(post.title) }] : undefined,
    },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let post: Record<string, unknown> | undefined;
  let contact: { contact_email: string | null; contact_phone: string | null } | undefined;
  try {
    post = await getPost(slug);
    const companyId = post ? await getStorefrontCompanyId() : undefined;
    contact = companyId ? await getCompanyPublicContact(companyId) : undefined;
  } catch (error) {
    console.error('BlogPostPage failed to load:', error);
    return (
      <div className="empty-state">
        <Newspaper size={28} />
        <p className="empty-state-title">This guide is temporarily unavailable</p>
        <p className="empty-state-desc">Please check back soon.</p>
      </div>
    );
  }
  if (!post) notFound();

  const body = String(post.body ?? '');
  const faq = faqOf(post.faq);
  const cover = coverOf(post.cover);
  const photos = Array.isArray(post.photos) ? (post.photos as PublicPhoto[]) : [];
  const title = String(post.title ?? '');
  const phone = contact?.contact_phone?.trim() || '';

  // Structured data, so search engines can show the date and the questions with the result. Built
  // from the stored fields only; JSON.stringify escapes them, and "<" is escaped as well so nothing
  // in a title can close the script element early.
  const structured = [
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: title,
      description: String(post.summary ?? ''),
      image: cover ? [cover.url] : undefined,
      datePublished: post.published_at ?? undefined,
      dateModified: post.updated_at ?? undefined,
      mainEntityOfPage: `${SITE_URL}/blog/${slug}`,
      author: { '@type': 'Organization', name: 'Jai Durga Enterprises' },
      publisher: { '@type': 'Organization', name: 'Jai Durga Enterprises' },
    },
    ...(faq.length > 0 ? [{
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map((item) => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })),
    }] : []),
  ];

  return (
    <article className="blog-article">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structured).replace(/</g, '\\u003c') }} />
      <Link href="/blog" className="text-muted text-sm flex items-center gap-2" style={{ textDecoration: 'none', marginBottom: '14px' }}>
        <ArrowLeft size={14} /> All guides
      </Link>
      <p className="blog-card-machine">{machineLabel(String(post.machine ?? ''))}</p>
      <h1>{title}</h1>
      <p className="blog-meta">{[dateOf(post.published_at), `${readMinutes(body)} min read`].filter(Boolean).join(' · ')}</p>
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <figure className="blog-cover"><img src={cover.url} alt={cover.alt || title} /></figure>
      )}
      {post.summary ? <p className="blog-lead">{String(post.summary)}</p> : null}

      <BlogBody body={body} photos={photos} />

      {faq.length > 0 && (
        <section className="blog-faq" aria-labelledby="blog-faq-heading">
          <h2 id="blog-faq-heading">Common questions</h2>
          {faq.map((item, index) => (
            <details key={index}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </section>
      )}

      {/* Added by the page, never written by the AI, so a phone number can never be made up. */}
      <aside className="blog-cta">
        <strong>Need parts for your machine?</strong>
        <span>We supply spare parts for backhoe loaders, rock breakers and excavators.</span>
        <div className="flex gap-2" style={{ flexWrap: 'wrap', marginTop: '10px' }}>
          <Link href="/catalog" className="btn btn-primary"><PackageSearch size={16} /> Browse the parts catalog</Link>
          {phone && <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="btn btn-secondary"><Phone size={16} /> Call {phone}</a>}
        </div>
      </aside>
    </article>
  );
}
