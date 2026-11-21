'use client';

import { useMemo, useState } from 'react';
import { Globe, MessageCircle, Newspaper, Pencil, PenLine, Trash2, Undo2 } from 'lucide-react';
import { useCompany } from '@/components/CompanyProvider';
import { useCompanyTable } from '@/lib/useCompanyTable';
import SummaryLine from '@/components/SummaryLine';
import RowMenu from '@/components/RowMenu';
import BlogWriterModal, { type WrittenDraft } from '@/components/blog/BlogWriterModal';
import BlogEditor, { type BlogPatch, type BlogPost } from '@/components/blog/BlogEditor';
import { indiaWhen, machineLabel, postState, postUrl, topicCoverage, uniqueSlug, whatsappShareUrl } from '@/lib/blog';
import { DEFAULT_FORMAT, formatLabel, nextFormat, type FormatId } from '@/lib/blog-formats';

/**
 * Blog: articles for the company website about backhoe loaders, rock breakers and excavators.
 *
 * The owner asked for something that writes new posts on all of these topics. "Write a new post"
 * picks a machine and a topic from the topic bank (lib/blog.ts), the AI writes a first draft, and it
 * opens here to be checked and published. Published posts appear on the public /blog pages and in
 * /api/public/blog, which the website reads; drafts never leave the ERP.
 *
 * Each new post is written in a different format from the last ones (lib/blog-formats.ts): the
 * writer opens with the format used least recently already chosen, and the owner can pick another.
 */

type Row = BlogPost & Record<string, unknown>;
type Show = 'all' | 'draft' | 'published';

const SITE_HOST = (process.env.NEXT_PUBLIC_SITE_URL || 'https://jd-enterprise.com').replace(/^https?:\/\//, '').replace(/\/$/, '');

const dateOf = (value: string | null | undefined): string => {
  const date = new Date(String(value ?? ''));
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
};

export default function BlogAdminPage() {
  const { configError } = useCompany();
  const { rows: posts, loading, error: loadError, create, update, remove, activeCompany } = useCompanyTable<Row>('blog_posts');
  const [writing, setWriting] = useState(false);
  // The format the next post is written in, picked when the writer opens.
  const [nextUp, setNextUp] = useState<FormatId>(DEFAULT_FORMAT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [show, setShow] = useState<Show>('all');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  const sorted = useMemo(
    () => [...posts].sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''))),
    [posts]
  );
  const writtenTopicIds = useMemo(() => new Set(posts.map((post) => post.topic_id).filter((id): id is string => Boolean(id))), [posts]);
  const published = posts.filter((post) => postState(post) === 'live');
  const scheduled = posts.filter((post) => postState(post) === 'scheduled');
  const drafts = posts.filter((post) => post.status !== 'published');
  const coverage = topicCoverage(writtenTopicIds);

  const tabs: Array<{ key: Show; label: string; rows: Row[] }> = [
    { key: 'all', label: 'All', rows: sorted },
    { key: 'draft', label: 'Drafts', rows: sorted.filter((post) => post.status !== 'published') },
    { key: 'published', label: 'Published', rows: sorted.filter((post) => post.status === 'published') },
  ];
  const visible = (tabs.find((tab) => tab.key === show) ?? tabs[0]).rows;

  const editing = editingId ? posts.find((post) => post.id === editingId) : undefined;

  /** Opens the writer with the format no recent post has used. */
  const openWriter = () => {
    const newestFirst = [...posts].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
    setNextUp(nextFormat(newestFirst.map((post) => post.format)));
    setFeedback('');
    setError('');
    setWriting(true);
  };

  /** The AI's draft, saved straight away so nothing it wrote can be lost, then opened to be checked. */
  const saveWritten = async (draft: WrittenDraft) => {
    const created = await create({
      slug: uniqueSlug(draft.title, posts.map((post) => post.slug)),
      title: draft.title,
      summary: draft.summary,
      machine: draft.machine,
      topic: draft.topic,
      topic_id: draft.topicId,
      format: draft.format,
      body: draft.body,
      faq: draft.faq,
      tags: draft.tags,
      fact_checks: draft.fact_checks,
      image_prompts: draft.image_prompts,
      status: 'draft',
      ai_model: draft.model,
    });
    setWriting(false);
    setFeedback('');
    setEditingId(created.id);
  };

  const setStatus = async (post: Row, status: 'draft' | 'published') => {
    setError('');
    const wasScheduled = postState(post) === 'scheduled';
    if (status === 'draft' && !window.confirm(wasScheduled ? `Cancel the schedule for "${post.title}"? It stays here as a draft.` : `Take "${post.title}" off the website? It stays here as a draft.`)) return;
    try {
      // A scheduled post taken off forgets its time, so publishing it later means publishing then.
      await update(post.id, wasScheduled ? { status, published_at: null } : { status });
      setFeedback(status === 'published' ? `"${post.title}" is on the website.` : wasScheduled ? `The schedule for "${post.title}" was cancelled. It is a draft again.` : `"${post.title}" was taken off the website.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not save.');
    }
  };

  const deletePost = async (post: Row) => {
    if (!window.confirm(`Delete "${post.title}" for good?${post.status === 'published' ? ' It will disappear from the website.' : ''}`)) return;
    setError('');
    try {
      await remove(post.id);
      setFeedback(`"${post.title}" was deleted.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'It was not deleted.');
    }
  };

  if (editing) {
    return (
      <BlogEditor
        key={editing.id}
        post={editing}
        otherSlugs={posts.filter((post) => post.id !== editing.id).map((post) => post.slug)}
        siteHost={SITE_HOST}
        onSave={async (patch: BlogPatch) => { await update(editing.id, patch); }}
        onDelete={async () => {
          const title = editing.title;
          await remove(editing.id);
          setEditingId(null);
          setFeedback(`"${title}" was deleted.`);
        }}
        onBack={() => setEditingId(null)}
      />
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Blog</h1>
          {posts.length > 0
            ? <SummaryLine facts={[
                { value: String(published.length), label: 'published', tone: published.length > 0 ? 'good' : undefined },
                ...(scheduled.length > 0 ? [{ value: String(scheduled.length), label: 'scheduled', hint: 'Go on the website by themselves at the time chosen' }] : []),
                { value: String(drafts.length), label: drafts.length === 1 ? 'draft' : 'drafts', tone: drafts.length > 0 ? 'warn' : undefined, hint: 'Written, but not on the website until you publish them' },
                { value: `${coverage.written} of ${coverage.total}`, label: 'topics written', hint: 'Topics in the topic bank that already have a post' },
              ]} />
            : <p className="page-subtitle">Articles for your website about backhoe loaders, rock breakers and excavators.</p>}
        </div>
        <div className="flex gap-2" style={{ marginLeft: 'auto', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {published.length > 0 && (
            <a href="/blog" target="_blank" rel="noreferrer" className="btn btn-secondary"><Globe size={16} /> View the blog</a>
          )}
          <button type="button" className="btn btn-primary" disabled={!activeCompany || Boolean(loadError)} onClick={openWriter}>
            <PenLine size={16} /> Write a new post
          </button>
        </div>
      </div>

      {configError && <div className="alert alert-danger mb-4" role="alert">Can&apos;t reach the database right now — {configError}</div>}
      {/* A failed read must not look like "no posts yet", or a new post could be written over a
          list that simply did not load. */}
      {!configError && loadError && (
        <div className="alert alert-danger mb-4" role="alert">
          The posts could not be loaded, so nothing can be written or published right now — {loadError}
        </div>
      )}
      {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}
      {error && <div className="alert alert-danger mb-4" role="alert">{error}</div>}

      {!configError && !loadError && (
        posts.length === 0 && !loading ? (
          <div className="card blog-start">
            <Newspaper size={30} aria-hidden="true" />
            <h2>Write your first post</h2>
            <p>Pick a machine and a topic, such as <em>Why rock breaker chisels break</em>. The AI writes the first draft in about a minute. You read it, change anything you want, and press Publish.</p>
            <p className="text-muted text-sm">There are {coverage.total} ready topics on backhoe loaders, rock breakers, excavators and parts, or type your own.</p>
            <button type="button" className="btn btn-primary btn-lg" disabled={!activeCompany} onClick={openWriter}><PenLine size={18} /> Write a new post</button>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="tbl-toolbar">
              <div className="tabs" role="group" aria-label="Which posts to show">
                {tabs.map((tab) => (
                  <button key={tab.key} type="button" aria-pressed={show === tab.key} className={`tab${show === tab.key ? ' active' : ''}`} onClick={() => setShow(tab.key)}>
                    {tab.label}<span className="tab-count">{tab.rows.length}</span>
                  </button>
                ))}
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="erp-table" style={{ minWidth: '720px' }}>
                <thead>
                  <tr><th>Post</th><th>Machine and format</th><th>Status</th><th>Date</th><th className="text-center">Actions</th></tr>
                </thead>
                <tbody>
                  {visible.map((post) => {
                    const state = postState(post);
                    const isLive = state === 'live';
                    return (
                      <tr key={post.id}>
                        <td style={{ maxWidth: '440px' }}>
                          <button type="button" className="part-name-btn" style={{ textAlign: 'left' }} onClick={() => setEditingId(post.id)}>{post.title}</button>
                          {post.summary && <div className="text-muted text-sm truncate">{post.summary}</div>}
                        </td>
                        <td>{machineLabel(post.machine)}<div className="text-muted text-sm">{formatLabel(post.format)}</div></td>
                        <td>{state === 'scheduled'
                          ? <span className="badge badge-warning" title="Goes on the website by itself at this time">Scheduled</span>
                          : isLive ? <span className="badge badge-success">Published</span> : <span className="badge badge-muted">Draft</span>}</td>
                        <td className="text-muted">{state === 'scheduled' ? `Goes live ${indiaWhen(post.published_at)}` : dateOf(isLive ? post.published_at : post.updated_at)}</td>
                        <td className="text-center">
                          <div className="flex gap-1 items-center" style={{ justifyContent: 'flex-end' }}>
                            <button type="button" className="btn btn-ghost btn-sm" aria-label={`Edit ${post.title}`} title={isLive ? 'Edit' : 'Check and publish'} onClick={() => setEditingId(post.id)}><Pencil size={14} /></button>
                            {isLive && <a className="btn btn-ghost btn-sm" aria-label={`Share ${post.title} on WhatsApp`} title="Share on WhatsApp" href={whatsappShareUrl(post, SITE_HOST)} target="_blank" rel="noreferrer"><MessageCircle size={14} /></a>}
                            {isLive && <a className="btn btn-ghost btn-sm" aria-label={`View ${post.title} on the website`} title="View on the website" href={postUrl(SITE_HOST, post.slug)} target="_blank" rel="noreferrer"><Globe size={14} /></a>}
                            <RowMenu
                              label={`More for ${post.title}`}
                              items={[
                                isLive
                                  ? { label: 'Take off the website', icon: <Undo2 size={15} />, onSelect: () => void setStatus(post, 'draft') }
                                  : state === 'scheduled'
                                    ? { label: 'Cancel the schedule', icon: <Undo2 size={15} />, onSelect: () => void setStatus(post, 'draft') }
                                    : { label: 'Check and publish', icon: <Globe size={15} />, onSelect: () => setEditingId(post.id) },
                                { label: 'Delete', icon: <Trash2 size={15} />, danger: true, onSelect: () => void deletePost(post) },
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {visible.length === 0 && (
                    <tr><td colSpan={5}><div className="empty-state">
                      <p className="empty-state-title">{loading ? 'Loading posts…' : 'Nothing here'}</p>
                      <p className="empty-state-desc">{loading ? 'Fetching posts for the active company.' : show === 'draft' ? 'Every post is published.' : 'No post is published yet.'}</p>
                    </div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {writing && activeCompany && (
        <BlogWriterModal companyId={activeCompany.id} writtenTopicIds={writtenTopicIds} suggestedFormat={nextUp} onWritten={saveWritten} onClose={() => setWriting(false)} />
      )}
    </div>
  );
}
