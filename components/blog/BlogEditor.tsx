'use client';

/**
 * Checking and changing one post before (or after) it goes on the website.
 *
 * The AI's draft lands here. On the side is what the AI itself was unsure of ("Check before
 * publishing"), which is never published. The article can be read exactly as the website will show
 * it with the Preview tab, because both use components/blog/BlogBody.tsx.
 *
 * Saving goes through the page (`onSave`), which writes through the generic table route like any
 * other edit, so every change is in the Log Book.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Eye, Globe, Plus, Trash2, X } from 'lucide-react';
import BlogBody from '@/components/blog/BlogBody';
import BlogPhotoPrompts from '@/components/blog/BlogPhotoPrompts';
import {
  MACHINES,
  SUMMARY_SHOWN,
  TITLE_SHOWN,
  isMachine,
  publicPhotos,
  publishProblems,
  readMinutes,
  saveProblems,
  slugify,
  splitTags,
  wordCount,
  type FaqItem,
  type ImagePrompt,
  type Machine,
} from '@/lib/blog';

export type BlogPost = {
  id: string;
  company_id: string;
  slug: string;
  title: string;
  summary: string;
  machine: string;
  topic: string;
  topic_id: string | null;
  body: string;
  faq: FaqItem[] | null;
  tags: string[] | null;
  fact_checks: string[] | null;
  /** The photos the post needs, as prompts for an AI image tool. Never published. */
  image_prompts: ImagePrompt[] | null;
  status: 'draft' | 'published';
  ai_model: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

export type BlogPatch = Partial<Pick<BlogPost, 'title' | 'slug' | 'summary' | 'machine' | 'body' | 'faq' | 'tags' | 'status' | 'image_prompts'>>;

type Form = { title: string; slug: string; summary: string; machine: Machine; tags: string; body: string; faq: FaqItem[] };

const formOf = (post: BlogPost): Form => ({
  title: post.title,
  slug: post.slug,
  summary: post.summary,
  machine: isMachine(post.machine) ? post.machine : 'general',
  tags: (post.tags ?? []).join(', '),
  body: post.body,
  faq: (post.faq ?? []).map((item) => ({ question: item.question, answer: item.answer })),
});

const same = (a: Form, b: Form) => JSON.stringify(a) === JSON.stringify(b);

export default function BlogEditor({ post, otherSlugs, siteHost, onSave, onDelete, onBack }: {
  post: BlogPost;
  /** Web addresses of this company's other posts, which this one may not take. */
  otherSlugs: string[];
  /** Shown before the web address, e.g. "jd-enterprise.com". */
  siteHost: string;
  onSave: (patch: BlogPatch) => Promise<void>;
  onDelete: () => Promise<void>;
  onBack: () => void;
}) {
  const [saved, setSaved] = useState<Form>(() => formOf(post));
  const [form, setForm] = useState<Form>(() => formOf(post));
  // While a draft's address has not been typed by hand, it follows the title.
  const [slugTouched, setSlugTouched] = useState(post.status === 'published' || post.slug !== slugify(post.title));
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [busy, setBusy] = useState<'' | 'save' | 'publish' | 'unpublish' | 'delete'>('');
  const [error, setError] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [message, setMessage] = useState('');

  const published = post.status === 'published';
  const dirty = !same(form, saved);
  const words = wordCount(form.body);

  // Closing the tab or reloading with changes not saved asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setMessage('');
    setProblems([]);
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === 'title' && !slugTouched) next.slug = slugify(String(value));
      return next;
    });
  };

  const setFaq = (index: number, patch: Partial<FaqItem>) =>
    set('faq', form.faq.map((item, n) => (n === index ? { ...item, ...patch } : item)));

  const patchOf = (): BlogPatch => ({
    title: form.title.trim(),
    slug: form.slug.trim(),
    summary: form.summary.trim(),
    machine: form.machine,
    tags: splitTags(form.tags),
    body: form.body.trim(),
    faq: form.faq.map((item) => ({ question: item.question.trim(), answer: item.answer.trim() })).filter((item) => item.question && item.answer),
  });

  const run = async (kind: typeof busy, patch: BlogPatch, done: string) => {
    setBusy(kind);
    setError('');
    setMessage('');
    try {
      await onSave(patch);
      setSaved(form);
      setMessage(done);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : 'It was not saved.';
      setError(/duplicate key|unique/i.test(text) ? 'Another post already uses this web address. Change it a little and save again.' : text);
    } finally {
      setBusy('');
    }
  };

  const saveDraft = () => {
    const patch = patchOf();
    // Only what would stop it saving at all: a draft may be short or unfinished.
    const blocking = saveProblems({ title: patch.title ?? '', slug: patch.slug ?? '' }, otherSlugs);
    if (blocking.length > 0) { setProblems(blocking); return; }
    void run('save', patch, published ? 'Saved. The website shows the new version.' : 'Draft saved.');
  };

  const publish = () => {
    const patch = patchOf();
    const found = publishProblems({ title: patch.title ?? '', slug: patch.slug ?? '', body: patch.body ?? '', summary: patch.summary ?? '' }, otherSlugs);
    if (found.length > 0) { setProblems(found); return; }
    void run('publish', { ...patch, status: 'published' }, 'Published. It is now on the website.');
  };

  const unpublish = () => {
    if (!window.confirm('Take this post off the website? It is kept here as a draft, and you can publish it again.')) return;
    void run('unpublish', { ...patchOf(), status: 'draft' }, 'Taken off the website. It is a draft again.');
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${post.title}" for good?${published ? ' It will disappear from the website.' : ''}`)) return;
    setBusy('delete');
    setError('');
    try {
      await onDelete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'It was not deleted.');
      setBusy('');
    }
  };

  const back = () => {
    if (dirty && !window.confirm('You have changes that are not saved. Leave without saving them?')) return;
    onBack();
  };

  const checks = post.fact_checks ?? [];
  // The uploaded photos, placed the way the website will place them.
  const preview = publicPhotos(post.image_prompts ?? []);
  const counter = (length: number, shown: number) => (
    <span className={`text-sm ${length > shown ? 'text-warning' : 'text-muted'}`}>{length} / {shown}{length > shown ? ' · Google may cut the end off' : ''}</span>
  );

  return (
    <div className="blog-editor">
      <div className="page-header" style={{ marginBottom: '16px' }}>
        <div>
          <button type="button" className="link-button text-sm flex items-center gap-2" style={{ marginBottom: '4px', textDecoration: 'none', color: 'var(--ink-3)', fontWeight: 500 }} onClick={back}>
            <ArrowLeft size={14} /> All posts
          </button>
          <h1 className="page-title flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
            {published ? 'Edit post' : 'Check and publish'}
            <span className={`badge ${published ? 'badge-success' : 'badge-muted'}`}>{published ? 'Published' : 'Draft'}</span>
          </h1>
        </div>
        {published && (
          <a href={`/blog/${post.slug}`} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ marginLeft: 'auto' }}>
            <Globe size={16} /> View on the website
          </a>
        )}
      </div>

      {message && <div className="alert alert-success mb-4" role="status">{message}</div>}
      {error && <div className="alert alert-danger mb-4" role="alert">{error}</div>}
      {problems.length > 0 && (
        <div className="alert alert-warning mb-4" role="alert">
          <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: '1px' }} />
          <span>{problems.length === 1 ? problems[0] : <>Before it can go on the website:<br />{problems.map((problem) => <span key={problem}>· {problem}<br /></span>)}</>}</span>
        </div>
      )}

      <div className="blog-editor-grid">
        <div className="card flex flex-col gap-4">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="blog-title">Title</label>
            <input id="blog-title" className="form-input" maxLength={110} value={form.title} disabled={Boolean(busy)} onChange={(event) => set('title', event.target.value)} />
            {counter(form.title.trim().length, TITLE_SHOWN)}
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="blog-summary">Summary <span className="text-muted" style={{ fontWeight: 400 }}>(shown by Google under the title)</span></label>
            <textarea id="blog-summary" className="form-input" rows={2} maxLength={300} value={form.summary} disabled={Boolean(busy)} onChange={(event) => set('summary', event.target.value)} />
            {counter(form.summary.trim().length, SUMMARY_SHOWN)}
          </div>
          <div className="form-grid-2">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="blog-machine">Machine</label>
              <select id="blog-machine" className="form-input form-select" value={form.machine} disabled={Boolean(busy)} onChange={(event) => set('machine', event.target.value as Machine)}>
                {MACHINES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="blog-tags">Tags <span className="text-muted" style={{ fontWeight: 400 }}>(with commas)</span></label>
              <input id="blog-tags" className="form-input" value={form.tags} disabled={Boolean(busy)} onChange={(event) => set('tags', event.target.value)} />
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="blog-slug">Web address</label>
            <div className="blog-slug">
              <span>{siteHost}/blog/</span>
              <input id="blog-slug" className="form-input" maxLength={80} value={form.slug} disabled={Boolean(busy)}
                onChange={(event) => { setSlugTouched(true); set('slug', event.target.value.toLowerCase().replace(/\s+/g, '-')); }} />
            </div>
            {published && form.slug !== saved.slug && <span className="text-warning text-sm">Changing the address breaks links people have already shared.</span>}
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: '8px' }}>
              <span className="form-label" style={{ margin: 0 }}>Article</span>
              <div className="tabs" role="tablist" aria-label="Article">
                <button type="button" role="tab" aria-selected={tab === 'write'} className={`tab${tab === 'write' ? ' active' : ''}`} onClick={() => setTab('write')}>Write</button>
                <button type="button" role="tab" aria-selected={tab === 'preview'} className={`tab${tab === 'preview' ? ' active' : ''}`} onClick={() => setTab('preview')}><Eye size={13} /> Preview</button>
              </div>
            </div>
            {tab === 'write' ? (
              <>
                <textarea aria-label="Article text" className="form-input blog-body-input" rows={22} value={form.body} disabled={Boolean(busy)} onChange={(event) => set('body', event.target.value)} />
                <span className="text-muted text-sm">## heading · - bullet point · 1. step · &gt; safety note · **bold** · {words} words, {readMinutes(form.body)} min read</span>
              </>
            ) : (
              <div className="blog-preview">
                <h1>{form.title || 'Untitled'}</h1>
                {preview.cover && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <figure className="blog-cover"><img src={preview.cover.url} alt={preview.cover.alt || form.title} /></figure>
                )}
                {form.summary && <p className="blog-lead">{form.summary}</p>}
                <BlogBody body={form.body} photos={preview.photos} />
              </div>
            )}
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <span className="form-label">Common questions <span className="text-muted" style={{ fontWeight: 400 }}>(shown under the article)</span></span>
            <div className="flex flex-col gap-3">
              {form.faq.map((item, index) => (
                <div key={index} className="blog-faq-edit">
                  <input className="form-input" aria-label={`Question ${index + 1}`} placeholder="Question" value={item.question} disabled={Boolean(busy)} onChange={(event) => setFaq(index, { question: event.target.value })} />
                  <textarea className="form-input" aria-label={`Answer ${index + 1}`} rows={2} placeholder="Answer" value={item.answer} disabled={Boolean(busy)} onChange={(event) => setFaq(index, { answer: event.target.value })} />
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove question ${index + 1}`} disabled={Boolean(busy)} onClick={() => set('faq', form.faq.filter((_, n) => n !== index))}><X size={14} /></button>
                </div>
              ))}
              <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} disabled={Boolean(busy) || form.faq.length >= 8}
                onClick={() => set('faq', [...form.faq, { question: '', answer: '' }])}>
                <Plus size={14} /> Add a question
              </button>
            </div>
          </div>
        </div>

        <aside className="flex flex-col gap-4">
          <BlogPhotoPrompts
            postId={post.id}
            companyId={post.company_id}
            prompts={post.image_prompts ?? []}
            article={{ title: form.title, body: form.body, machine: form.machine }}
            disabled={Boolean(busy)}
            onReplace={async (prompts) => { await onSave({ image_prompts: prompts }); }}
          />
          <div className="card blog-checks">
            <strong className="flex items-center gap-2"><AlertTriangle size={16} aria-hidden="true" /> Check before publishing</strong>
            <p className="text-sm">The AI writes well but can get details wrong for a particular machine. Read the article once.{checks.length > 0 ? ' It was not sure about these:' : ''}</p>
            {checks.length > 0
              ? <ul>{checks.map((check) => <li key={check}>{check}</li>)}</ul>
              : <p className="text-sm text-muted">It flagged nothing in particular.</p>}
            <p className="text-sm text-muted">This box is only for you. It never appears on the website.</p>
          </div>
          <div className="card text-sm text-muted flex flex-col gap-2">
            <span><strong style={{ color: 'var(--ink)' }}>Topic asked for:</strong> {post.topic || '—'}</span>
            {post.ai_model && <span>First draft by {post.ai_model}.</span>}
            <span>Your phone number and a link to your parts catalog are added under every post automatically.</span>
          </div>
        </aside>
      </div>

      <div className={`save-bar blog-save-bar${dirty ? ' has-changes' : ''}`}>
        <div className="save-bar-text">
          <strong>{busy ? 'Saving…' : dirty ? 'Changes not saved yet' : published ? 'On the website' : 'Draft: not on the website yet'}</strong>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost" style={{ color: 'var(--color-danger)' }} disabled={Boolean(busy)} onClick={remove}><Trash2 size={15} /> Delete</button>
          {published && <button type="button" className="btn btn-secondary" disabled={Boolean(busy)} onClick={unpublish}>Take off the website</button>}
          {!published && <button type="button" className="btn btn-secondary" disabled={Boolean(busy) || !dirty} onClick={saveDraft}>Save draft</button>}
          {published
            ? <button type="button" className="btn btn-primary" disabled={Boolean(busy) || !dirty} onClick={saveDraft}>Save changes</button>
            : <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={publish}><Globe size={16} /> Publish</button>}
        </div>
      </div>
    </div>
  );
}
