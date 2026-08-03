'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ChangeEvent, useEffect, useState } from 'react';
import { ArrowLeft, Sparkles, Upload, Search, CheckCircle2, XCircle, HelpCircle, ExternalLink, Trash2, RefreshCw, AlertTriangle, Copy } from 'lucide-react';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { fileToBase64 } from '@/lib/client-import';
import { buildCatalogImagePrompt } from '@/lib/catalogPrompt';
import { canPublish, catalogDisplayStatus, checkInventoryDrift, computeAvailabilityFromStock, missingRequiredFields, type CatalogProduct, type ReferenceCandidate } from '@/lib/catalogTypes';

type Product = { id: string; name: string; current_stock: number; cost_price: number; sale_price: number };

const AVAILABILITY_LABEL: Record<CatalogProduct['availability'], string> = {
  in_stock: 'In Stock', out_of_stock: 'Out of Stock', contact_for_availability: 'Contact for Availability',
};

const AVAILABILITY_OPTIONS: Array<{ value: CatalogProduct['availability']; label: string }> = [
  { value: 'in_stock', label: 'In Stock' },
  { value: 'out_of_stock', label: 'Out of Stock' },
  { value: 'contact_for_availability', label: 'Contact for Availability' },
];

export default function CatalogAdminDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { rows: catalogRows, loading, update, remove, reload } = useCompanyTable<CatalogProduct>('catalog_products');
  const { rows: products } = useCompanyTable<Product>('products');

  const row = catalogRows.find((r) => r.id === id);
  const product = row ? products.find((p) => p.id === row.erp_product_id) : undefined;

  const [form, setForm] = useState({
    title: '', part_number: '', oem_number: '', category: '', brand: '', compatibility: '',
    price: '', availability: 'in_stock' as CatalogProduct['availability'], description: '',
  });
  const [savingFields, setSavingFields] = useState(false);
  const [fieldsSaved, setFieldsSaved] = useState(false);

  const [referenceQuery, setReferenceQuery] = useState('');
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [referenceError, setReferenceError] = useState('');

  const [promptText, setPromptText] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);
  const [promptCopyError, setPromptCopyError] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState('');

  const [descBusy, setDescBusy] = useState(false);
  const [descError, setDescError] = useState('');
  const [descDraft, setDescDraft] = useState({ short_description: '', key_features: '', compatible_machines: '', search_keywords: '', warnings: '' });

  const [reviewer, setReviewer] = useState('');
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState('');

  useEffect(() => {
    if (!row) return;
    setForm({
      title: row.title || '', part_number: row.part_number || '', oem_number: row.oem_number || '',
      category: row.category || '', brand: row.brand || '', compatibility: row.compatibility || '',
      price: row.price != null ? String(row.price) : '', availability: row.availability || 'in_stock',
      description: row.description || '',
    });
    setReferenceQuery(row.reference_query || [row.title, row.brand, row.part_number, row.oem_number].filter(Boolean).join(' '));
    setPromptText(row.generated_prompt || '');
    setReviewer(row.reviewer || '');
    if (row.generated_description) {
      setDescDraft({
        short_description: row.generated_description.short_description || '',
        key_features: (row.generated_description.key_features || []).join('\n'),
        compatible_machines: (row.generated_description.compatible_machines || []).join('\n'),
        search_keywords: (row.generated_description.search_keywords || []).join('\n'),
        warnings: (row.generated_description.warnings || []).join('\n'),
      });
    }
    // Only re-sync from the loaded row, never from local edits — deliberately excludes `form`/`descDraft`/etc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, row?.updated_at]);

  if (loading && !row) {
    return <div className="empty-state"><p className="empty-state-title">Loading…</p></div>;
  }
  if (!row) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Catalog draft not found</p>
        <p className="empty-state-desc">It may have been deleted.</p>
        <Link href="/catalog-admin" className="btn btn-secondary mt-4">Back to Website Catalog</Link>
      </div>
    );
  }

  const status = catalogDisplayStatus(row);
  const missing = missingRequiredFields(row);
  const publishReady = canPublish(row);
  const drift = checkInventoryDrift(row, product);
  const driftBlocksPublish = drift.productMissing || Boolean(drift.priceDrift) || Boolean(drift.availabilityDrift);

  const saveFields = async () => {
    setSavingFields(true);
    setFieldsSaved(false);
    try {
      await update(row.id, {
        title: form.title, part_number: form.part_number, oem_number: form.oem_number,
        category: form.category, brand: form.brand, compatibility: form.compatibility,
        price: form.price.trim() ? Number(form.price) : null, availability: form.availability,
        description: form.description,
      });
      setFieldsSaved(true);
    } finally {
      setSavingFields(false);
    }
  };

  const runReferenceSearch = async () => {
    setReferenceLoading(true);
    setReferenceError('');
    try {
      const res = await fetch('/api/ai-catalog-reference-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.title, part_number: form.part_number, oem_number: form.oem_number, brand: form.brand, category: form.category }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Reference search failed.');
      await update(row.id, { reference_query: referenceQuery, reference_candidates: body.candidates as ReferenceCandidate[] });
    } catch (err) {
      setReferenceError(err instanceof Error ? err.message : 'Reference search failed.');
    } finally {
      setReferenceLoading(false);
    }
  };

  const setCandidateVerdict = async (index: number, verdict: ReferenceCandidate['verdict']) => {
    const candidates = [...(row.reference_candidates || [])];
    candidates[index] = { ...candidates[index], verdict };
    await update(row.id, { reference_candidates: candidates });
  };

  const useAsReference = async (url: string) => {
    await update(row.id, { selected_reference_url: url });
  };

  const generatePrompt = () => {
    setPromptText(buildCatalogImagePrompt({
      name: form.title, part_number: form.part_number, oem_number: form.oem_number,
      brand: form.brand, category: form.category, compatibility: form.compatibility,
    }));
  };

  const copyPrompt = async () => {
    setPromptCopyError('');
    try {
      await navigator.clipboard.writeText(promptText);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked by the browser/OS — still save the prompt either way,
      // and tell the admin to copy it by hand instead of failing silently.
      setPromptCopyError('Could not copy automatically — select the text above and copy it manually.');
    }
    await update(row.id, { generated_prompt: promptText });
  };

  const generateImageWithAi = async () => {
    setImageBusy(true);
    setImageError('');
    try {
      const res = await fetch('/api/ai-catalog-generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalogId: row.id, prompt: promptText, referenceImageUrl: row.selected_reference_url }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Image generation failed.');
      await reload();
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Image generation failed.');
    } finally {
      setImageBusy(false);
    }
  };

  const uploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImageBusy(true);
    setImageError('');
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch('/api/catalog-image-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalogId: row.id, base64, mimeType: file.type }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Upload failed.');
      await reload();
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setImageBusy(false);
    }
  };

  const generateDescription = async () => {
    setDescBusy(true);
    setDescError('');
    try {
      const res = await fetch('/api/ai-catalog-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.title, part_number: form.part_number, oem_number: form.oem_number, brand: form.brand, category: form.category, compatibility: form.compatibility, description: form.description }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Description draft failed.');
      setDescDraft({
        short_description: body.short_description || '',
        key_features: (body.key_features || []).join('\n'),
        compatible_machines: (body.compatible_machines || []).join('\n'),
        search_keywords: (body.search_keywords || []).join('\n'),
        warnings: (body.warnings || []).join('\n'),
      });
      await update(row.id, { generated_description: body });
    } catch (err) {
      setDescError(err instanceof Error ? err.message : 'Description draft failed.');
    } finally {
      setDescBusy(false);
    }
  };

  const useDescriptionDraft = async () => {
    const features = descDraft.key_features.split('\n').map((s) => s.trim()).filter(Boolean);
    const flat = [descDraft.short_description.trim(), ...features.map((f) => `• ${f}`)].filter(Boolean).join('\n');
    setForm((f) => ({ ...f, description: flat }));
    await update(row.id, { description: flat });
  };

  const syncFromInventory = async () => {
    if (!product) return;
    const liveAvailability = computeAvailabilityFromStock(product.current_stock);
    const price = product.sale_price || null;
    setForm((f) => ({ ...f, price: price != null ? String(price) : '', availability: liveAvailability }));
    await update(row.id, { price, availability: liveAvailability });
  };

  const publish = async () => {
    setPublishBusy(true);
    setPublishError('');
    try {
      if (!publishReady) throw new Error('Complete the required fields and image before publishing.');
      await update(row.id, { publication_status: 'published', published_at: new Date().toISOString(), reviewer: reviewer || null });
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Could not publish.');
    } finally {
      setPublishBusy(false);
    }
  };

  const unpublish = async () => {
    setPublishBusy(true);
    setPublishError('');
    try {
      await update(row.id, { publication_status: 'unpublished' });
    } finally {
      setPublishBusy(false);
    }
  };

  const archive = async () => {
    setPublishBusy(true);
    setPublishError('');
    try {
      await update(row.id, { publication_status: 'archived' });
    } finally {
      setPublishBusy(false);
    }
  };

  const deleteDraft = async () => {
    if (!confirm(`Delete this catalog draft for "${row.title}"? This cannot be undone.`)) return;
    await remove(row.id);
    router.push('/catalog-admin');
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <Link href="/catalog-admin" className="btn btn-ghost btn-sm mb-2"><ArrowLeft size={14} /> Back to Website Catalog</Link>
          <h1 className="page-title">{row.title || '(untitled)'} <span className={`badge ${status.cls}`} style={{ marginLeft: '10px', verticalAlign: 'middle' }}>{status.label}</span></h1>
          {product && <p className="page-subtitle">From Inventory: {product.current_stock} in stock, cost ₹{product.cost_price}</p>}
        </div>
        {row.publication_status !== 'published' && (
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} onClick={deleteDraft}>
            <Trash2 size={14} /> Delete
          </button>
        )}
      </div>

      {/* Required fields */}
      <div className="card mb-6">
        <div className="card-header"><h3 className="card-title">Product Details</h3></div>
        <div className="p-4 flex flex-col gap-4">
          {missing.length > 0 && (
            <div className="alert alert-danger" role="alert">Missing before publish: {missing.join(', ')}</div>
          )}
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Product Name *</label>
              <input className="form-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Part Number *</label>
              <input className="form-input" value={form.part_number} onChange={(e) => setForm({ ...form, part_number: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">OEM Number</label>
              <input className="form-input" value={form.oem_number} onChange={(e) => setForm({ ...form, oem_number: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Category *</label>
              <input className="form-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Brand</label>
              <input className="form-input" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Compatibility</label>
              <input className="form-input" value={form.compatibility} onChange={(e) => setForm({ ...form, compatibility: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Selling Price (₹, blank = Request Quote)</label>
              <input className="form-input" type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Availability</label>
              <select className="form-input form-select" value={form.availability} onChange={(e) => setForm({ ...form, availability: e.target.value as CatalogProduct['availability'] })}>
                {AVAILABILITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Description (shown on the website)</label>
            <textarea className="form-input" rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <button className="btn btn-primary" disabled={savingFields} onClick={saveFields}>{savingFields ? 'Saving…' : 'Save Details'}</button>
            {fieldsSaved && <span style={{ marginLeft: '10px', color: 'var(--color-success)', fontSize: '13px' }}>Saved.</span>}
          </div>
        </div>
      </div>

      {/* Reference search */}
      <div className="card mb-6">
        <div className="card-header"><h3 className="card-title">Reference Search <span style={{ fontWeight: 400, fontSize: '12px', color: 'var(--text-muted)' }}>(guidance only — never published)</span></h3></div>
        <div className="p-4 flex flex-col gap-4">
          <div className="search-bar">
            <Search className="search-bar-icon" size={16} />
            <input value={referenceQuery} onChange={(e) => setReferenceQuery(e.target.value)} placeholder="Search terms" />
          </div>
          <div>
            <button className="btn btn-secondary" disabled={referenceLoading} onClick={runReferenceSearch}>
              <Sparkles size={16} /> {referenceLoading ? 'Searching…' : 'Search References'}
            </button>
          </div>
          {referenceError && <div className="alert alert-danger" role="alert">{referenceError}</div>}
          {(row.reference_candidates || []).length > 0 && (
            <div className="flex flex-col gap-2">
              {(row.reference_candidates || []).map((c, i) => (
                <div key={i} className="card card-sm flex items-center gap-3" style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <div style={{ minWidth: 0 }}>
                    <a href={c.sourceUrl || c.url} target="_blank" rel="noreferrer" className="font-semibold truncate" style={{ display: 'block', color: 'var(--brand-primary)' }}>
                      {c.title || c.domain || c.url} <ExternalLink size={12} style={{ display: 'inline' }} />
                    </a>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{c.domain} · {c.kind === 'image' ? 'Image result' : 'Web page'}</span>
                    {row.selected_reference_url === c.url && <span className="badge badge-success" style={{ marginLeft: '8px' }}>Selected</span>}
                  </div>
                  <div className="flex gap-1" style={{ flexShrink: 0 }}>
                    <button className={`btn btn-sm ${c.verdict === 'useful' ? 'btn-primary' : 'btn-ghost'}`} title="Useful" onClick={() => setCandidateVerdict(i, 'useful')}><CheckCircle2 size={14} /></button>
                    <button className={`btn btn-sm ${c.verdict === 'uncertain' ? 'btn-primary' : 'btn-ghost'}`} title="Uncertain" onClick={() => setCandidateVerdict(i, 'uncertain')}><HelpCircle size={14} /></button>
                    <button className={`btn btn-sm ${c.verdict === 'wrong' ? 'btn-primary' : 'btn-ghost'}`} title="Wrong" onClick={() => setCandidateVerdict(i, 'wrong')}><XCircle size={14} /></button>
                    {c.kind === 'image' && <button className="btn btn-secondary btn-sm" onClick={() => useAsReference(c.url)}>Use as Reference</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Image prompt + image */}
      <div className="card mb-6">
        <div className="card-header"><h3 className="card-title">Product Image</h3></div>
        <div className="p-4 flex flex-col gap-4">
          <div className="form-group">
            <label className="form-label">Image Prompt</label>
            <textarea className="form-input" rows={8} style={{ fontFamily: 'monospace', fontSize: '12px' }} value={promptText} onChange={(e) => setPromptText(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary" onClick={generatePrompt}>Generate Prompt from Details</button>
            <button className="btn btn-ghost" onClick={copyPrompt} disabled={!promptText.trim()}>
              <Copy size={16} /> {promptCopied ? 'Copied!' : 'Copy Prompt'}
            </button>
          </div>
          {promptCopyError && <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{promptCopyError}</p>}

          {imageError && <div className="alert alert-danger" role="alert">{imageError}</div>}
          {row.image_status === 'failed' && row.generation_error && !imageError && (
            <div className="alert alert-danger" role="alert">Last AI attempt failed: {row.generation_error}</div>
          )}

          <div className="flex gap-4 items-center flex-wrap">
            {row.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.image_url} alt={row.title} style={{ width: '160px', height: '160px', objectFit: 'contain', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', border: '1px solid var(--border-default)' }} />
            ) : (
              <div className="empty-state" style={{ width: '160px', height: '160px' }}><p className="empty-state-desc">No image yet</p></div>
            )}
            <div className="flex flex-col gap-2">
              <button className="btn btn-primary" disabled={imageBusy || !promptText.trim()} onClick={generateImageWithAi}>
                <Sparkles size={16} /> {imageBusy ? 'Working…' : 'Generate with AI'}
              </button>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {row.selected_reference_url
                  ? 'Will use your selected reference photo as a visual guide.'
                  : 'No reference photo selected — pick one above for a closer match, or it\'ll generate from the text description alone.'}
              </span>
              <label className="btn btn-secondary" style={{ cursor: imageBusy ? 'not-allowed' : 'pointer' }}>
                <Upload size={16} /> Upload Real Photo
                <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={imageBusy} onChange={uploadImage} />
              </label>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Uploading a real photo is always the most accurate option.</span>
            </div>
          </div>
        </div>
      </div>

      {/* Description draft */}
      <div className="card mb-6">
        <div className="card-header"><h3 className="card-title">Description Draft</h3></div>
        <div className="p-4 flex flex-col gap-4">
          <button className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} disabled={descBusy} onClick={generateDescription}>
            <Sparkles size={16} /> {descBusy ? 'Drafting…' : 'Generate Draft'}
          </button>
          {descError && <div className="alert alert-danger" role="alert">{descError}</div>}
          <div className="form-group">
            <label className="form-label">Short Description</label>
            <textarea className="form-input" rows={2} value={descDraft.short_description} onChange={(e) => setDescDraft({ ...descDraft, short_description: e.target.value })} />
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Key Features (one per line)</label>
              <textarea className="form-input" rows={4} value={descDraft.key_features} onChange={(e) => setDescDraft({ ...descDraft, key_features: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Compatible Machines (one per line)</label>
              <textarea className="form-input" rows={4} value={descDraft.compatible_machines} onChange={(e) => setDescDraft({ ...descDraft, compatible_machines: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Search Keywords (one per line)</label>
              <textarea className="form-input" rows={3} value={descDraft.search_keywords} onChange={(e) => setDescDraft({ ...descDraft, search_keywords: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Warnings (one per line, usually empty)</label>
              <textarea className="form-input" rows={3} value={descDraft.warnings} onChange={(e) => setDescDraft({ ...descDraft, warnings: e.target.value })} />
            </div>
          </div>
          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={useDescriptionDraft}>Use as Website Description</button>
        </div>
      </div>

      {/* Publish controls */}
      <div className="card">
        <div className="card-header"><h3 className="card-title">Review &amp; Publish</h3></div>
        <div className="p-4 flex flex-col gap-4">
          {publishError && <div className="alert alert-danger" role="alert">{publishError}</div>}
          {row.published_at && <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Last published {new Date(row.published_at).toLocaleString()} by {row.reviewer || 'unknown'}.</p>}

          {publishReady && row.publication_status !== 'published' && drift.productMissing && (
            <div className="alert alert-danger" role="alert">
              <AlertTriangle size={14} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'text-bottom' }} />
              This part no longer exists in Inventory — publishing is disabled until that's resolved.
            </div>
          )}
          {publishReady && row.publication_status !== 'published' && !drift.productMissing && driftBlocksPublish && (
            <div className="alert alert-warning" role="alert" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <AlertTriangle size={14} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'text-bottom' }} />
                Inventory has changed since these were set — the ERP is the source of truth, so double-check before publishing:
                <ul style={{ margin: '6px 0 0 20px' }}>
                  {drift.priceDrift && <li>Inventory price is now ₹{drift.priceDrift.inventory} (this listing shows ₹{drift.priceDrift.catalog})</li>}
                  {drift.availabilityDrift && <li>Inventory now shows {AVAILABILITY_LABEL[drift.availabilityDrift.inventory]} (this listing shows {AVAILABILITY_LABEL[drift.availabilityDrift.catalog]})</li>}
                </ul>
              </div>
              <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={syncFromInventory}><RefreshCw size={14} /> Sync from Inventory</button>
            </div>
          )}

          <div className="form-group" style={{ maxWidth: '320px' }}>
            <label className="form-label">Reviewer Name</label>
            <input className="form-input" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Who is approving this?" />
          </div>
          <div className="flex gap-2 flex-wrap">
            {row.publication_status !== 'published' ? (
              driftBlocksPublish ? (
                <button className="btn btn-primary" disabled={publishBusy || !publishReady || drift.productMissing} onClick={publish} title="Publishes with the values currently shown above, despite the Inventory mismatch">
                  {publishBusy ? 'Publishing…' : 'Publish Anyway (Keep Current Values)'}
                </button>
              ) : (
                <button className="btn btn-primary" disabled={publishBusy || !publishReady} onClick={publish}>
                  {publishBusy ? 'Publishing…' : 'Publish to Website'}
                </button>
              )
            ) : (
              <button className="btn btn-secondary" disabled={publishBusy} onClick={unpublish}>{publishBusy ? 'Working…' : 'Unpublish'}</button>
            )}
            {row.publication_status !== 'archived' && (
              <button className="btn btn-ghost" disabled={publishBusy} onClick={archive}>Archive</button>
            )}
            {row.publication_status === 'published' && (
              <Link href={`/catalog/${row.id}`} target="_blank" className="btn btn-ghost"><ExternalLink size={14} /> View Live</Link>
            )}
          </div>
          {!publishReady && row.publication_status !== 'published' && (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Publish is disabled until all required fields and the image are ready (see checklist above).</p>
          )}
        </div>
      </div>
    </div>
  );
}
