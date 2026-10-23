'use client';

import Link from 'next/link';
import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Camera, ChevronLeft, ChevronRight, ImagePlus, Search } from 'lucide-react';
import PartPhoto from '@/components/PartPhoto';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { usePartPhotos } from '@/lib/usePartPhotos';
import { savePartPhoto } from '@/lib/client-part-photo';
import { money } from '@/lib/money';

type Part = {
  id: string;
  part_number?: string | null;
  name: string;
  brand?: string | null;
  category?: string | null;
  compatibility?: string | null;
  sale_price?: number | null;
  current_stock?: number | null;
  location?: string | null;
  image_url?: string | null;
};
type Show = 'missing' | 'all';

/**
 * Adding photos to parts, one after another: the part's details, a big button that opens the phone
 * camera, a look at the photo, then Save & next. Each photo is saved on the part (and so shown
 * everywhere the part is) and, when the company has Google Drive connected, copied there too, in
 * Parts catalogue/Photos (lib/parts-drive.ts).
 *
 * Parts in stock come first: those are the ones being sold and looked for.
 */
export default function PartPhotosPage() {
  const { rows: parts, loading, reload, activeCompany } = useCompanyTable<Part>('products');
  const photoFor = usePartPhotos();
  const [show, setShow] = useState<Show>('missing');
  const [search, setSearch] = useState('');
  const [index, setIndex] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // Parts photographed in this sitting stay in the list until the page is left, so the queue does
  // not jump under the owner's thumb the moment a photo is saved.
  const [doneHere, setDoneHere] = useState<Set<string>>(new Set());
  // Whether this company's Google Drive is connected, so the page only promises a Drive copy when
  // there will be one. Unknown (null) for staff, who cannot see the owner's Drive settings.
  const [driveOn, setDriveOn] = useState<boolean | null>(null);
  const companyId = activeCompany?.id ?? '';
  useEffect(() => {
    if (!companyId) return;
    let active = true;
    fetch(`/api/drive?companyId=${encodeURIComponent(companyId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { connection?: unknown } | null) => { if (active) setDriveOn(body ? Boolean(body.connection) : null); })
      .catch(() => { if (active) setDriveOn(null); });
    return () => { active = false; };
  }, [companyId]);

  const withPhoto = parts.filter((part) => photoFor(part)).length;
  const queue = useMemo(() => {
    const term = search.trim().toLowerCase();
    return parts
      .filter((part) => show === 'all' || !photoFor(part) || doneHere.has(part.id))
      .filter((part) => !term || `${part.part_number ?? ''} ${part.name} ${part.brand ?? ''} ${part.compatibility ?? ''}`.toLowerCase().includes(term))
      .sort((a, b) => Number((b.current_stock ?? 0) > 0) - Number((a.current_stock ?? 0) > 0)
        || String(a.part_number ?? '').localeCompare(String(b.part_number ?? ''))
        || a.name.localeCompare(b.name));
  }, [parts, show, search, photoFor, doneHere]);

  const part = queue[Math.min(index, Math.max(0, queue.length - 1))];
  const current = part ? photoFor(part) : null;

  // The picked photo, shown before it is saved; its temporary address is released when it changes.
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0] ?? null;
    event.target.value = '';
    setError('');
    setMessage('');
    setFile(chosen);
  };

  // Moving to another part, or another list, always starts without a picked photo.
  const go = (by: number) => {
    setError('');
    setFile(null);
    setIndex((at) => Math.max(0, Math.min(queue.length - 1, at + by)));
  };

  const save = async () => {
    if (!file || !part || !activeCompany) return;
    setSaving(true);
    setError('');
    try {
      await savePartPhoto(activeCompany.id, part.id, file);
      setDoneHere((done) => new Set(done).add(part.id));
      await reload();
      setMessage(`Photo saved for ${part.name}.`);
      setFile(null);
      go(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The photo was not saved.');
    } finally {
      setSaving(false);
    }
  };

  const percent = parts.length ? Math.round((withPhoto / parts.length) * 100) : 0;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <Link href="/inventory" className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }}><ArrowLeft size={14} /> Inventory</Link>
          <h1 className="page-title">Part photos</h1>
          <p className="page-subtitle">{withPhoto} of {parts.length} parts have a photo. To change one, choose All parts and find it.{driveOn === true ? ' Each photo is also saved to your Google Drive, in Parts catalogue.' : driveOn === false ? ' Connect Google Drive in Settings to keep a copy of every photo there too.' : ''}</p>
        </div>
      </div>

      <div style={{ height: 8, borderRadius: 4, background: 'var(--panel-2)', overflow: 'hidden', marginBottom: 16 }} aria-hidden="true">
        <div style={{ width: `${percent}%`, height: '100%', background: 'var(--color-success)' }} />
      </div>

      <div className="flex gap-2 mb-4" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="tabs" role="group" aria-label="Which parts">
          <button type="button" aria-pressed={show === 'missing'} className={`tab ${show === 'missing' ? 'active' : ''}`} onClick={() => { setShow('missing'); setIndex(0); setFile(null); }}>Without a photo</button>
          <button type="button" aria-pressed={show === 'all'} className={`tab ${show === 'all' ? 'active' : ''}`} onClick={() => { setShow('all'); setIndex(0); setFile(null); }}>All parts</button>
        </div>
        <div style={{ position: 'relative', flex: '1 1 200px' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }} />
          <input className="form-input" style={{ paddingLeft: 30, width: '100%' }} placeholder="Find a part" value={search} onChange={(event) => { setSearch(event.target.value); setIndex(0); setFile(null); }} aria-label="Find a part" />
        </div>
      </div>

      {message && <div className="alert alert-success mb-4" role="status">{message}</div>}
      {error && <div className="alert alert-danger mb-4" role="alert">{error}</div>}

      {loading && parts.length === 0 && <div className="skeleton" style={{ height: 320 }} />}

      {!loading && !part && (
        <div className="card"><div className="empty-state">
          <p className="empty-state-title">{show === 'missing' && !search ? 'Every part has a photo' : 'No part matches'}</p>
          <p className="empty-state-desc">{show === 'missing' && !search ? 'Switch to All parts to change a photo.' : 'Try another search.'}</p>
        </div></div>
      )}

      {part && (
        <div className="card">
          <div className="flex justify-between items-center mb-4" style={{ gap: 8 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => go(-1)} disabled={index === 0 || saving}><ChevronLeft size={16} /> Back</button>
            <span className="text-muted text-sm">{Math.min(index, queue.length - 1) + 1} of {queue.length}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => go(1)} disabled={index >= queue.length - 1 || saving}>Skip <ChevronRight size={16} /></button>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '0 0 auto' }}>
              {preview
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={preview} alt={`New photo of ${part.name}`} style={{ width: 220, height: 220, objectFit: 'cover', borderRadius: 12, border: '2px solid var(--color-success)' }} />
                : <PartPhoto url={current?.url} name={part.name} size={220} />}
              {current && !preview && <div className="text-muted text-sm" style={{ marginTop: 4 }}>{current.source === 'own' ? 'Current photo' : 'Website picture'}</div>}
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              {part.part_number && <span className="pn-chip">{part.part_number}</span>}
              <h2 style={{ fontSize: 20, fontWeight: 700, margin: '6px 0' }}>{part.name}</h2>
              <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 14 }}>
                {part.brand && <><dt className="text-muted">Brand</dt><dd>{part.brand}</dd></>}
                {part.category && <><dt className="text-muted">Category</dt><dd>{part.category}</dd></>}
                {part.compatibility && <><dt className="text-muted">Fits</dt><dd>{part.compatibility}</dd></>}
                <dt className="text-muted">In stock</dt><dd>{Number(part.current_stock ?? 0)}</dd>
                {part.location && <><dt className="text-muted">Kept at</dt><dd>{part.location}</dd></>}
                {Number(part.sale_price) > 0 && <><dt className="text-muted">Price</dt><dd>₹{money(Number(part.sale_price))}</dd></>}
              </dl>
            </div>
          </div>

          <div className="flex gap-2" style={{ marginTop: 20, flexWrap: 'wrap' }}>
            {!file ? (
              <>
                <label className="btn btn-primary" style={{ flex: '1 1 200px', justifyContent: 'center', padding: '14px 16px', fontSize: 16, cursor: 'pointer' }}>
                  <Camera size={20} /> {current ? 'Take a new photo' : 'Take photo'}
                  <input type="file" accept="image/*" capture="environment" hidden onChange={pick} />
                </label>
                <label className="btn btn-secondary" style={{ flex: '1 1 160px', justifyContent: 'center', padding: '14px 16px', cursor: 'pointer' }}>
                  <ImagePlus size={18} /> From gallery
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/*" hidden onChange={pick} />
                </label>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-primary" style={{ flex: '1 1 200px', justifyContent: 'center', padding: '14px 16px', fontSize: 16 }} disabled={saving} onClick={save}>
                  {saving ? 'Saving…' : 'Save & next'}
                </button>
                <button type="button" className="btn btn-secondary" style={{ flex: '1 1 140px', justifyContent: 'center', padding: '14px 16px' }} disabled={saving} onClick={() => setFile(null)}>
                  Retake
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
