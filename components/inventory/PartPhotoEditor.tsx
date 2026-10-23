'use client';

/**
 * A part's photo with the ways to change it, side by side: take a new one with the camera, pick one
 * from the gallery, or take the photo off. The owner could not find how to change a photo — it was
 * only in the part's detail window and the Add Photos screen — so the Edit Part window carries this
 * too (lib/client-part-photo.ts does the saving; the photo replaces the old one straight away).
 */

import { useState, type ChangeEvent } from 'react';
import { Camera, ImagePlus, Trash2 } from 'lucide-react';
import PartPhoto from '@/components/PartPhoto';
import { removePartPhoto, savePartPhoto } from '@/lib/client-part-photo';
import type { PartPhotoRef } from '@/lib/part-photos';

export default function PartPhotoEditor({ companyId, productId, name, photo, onChanged }: {
  companyId: string;
  productId: string;
  name: string;
  /** The photo shown now: the part's own, or its website picture. */
  photo: PartPhotoRef | null;
  /** After a change is saved, so the screen behind can show the new photo. */
  onChanged: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const own = photo?.source === 'own';

  const run = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError('');
    try {
      await work();
      onChanged(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The photo was not changed.');
    } finally {
      setBusy(false);
    }
  };

  const chosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void run(() => savePartPhoto(companyId, productId, file), own ? `Photo of ${name} changed.` : `Photo added to ${name}.`);
  };

  return (
    <div className="part-photo-editor" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <PartPhoto url={photo?.url} name={name} size={88} busy={busy} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <span className="text-muted text-sm">
          {busy ? 'Saving the photo…' : own ? 'Your photo of this part.' : photo ? 'Picture from your website. Add your own to use it instead.' : 'No photo yet.'}
        </span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <label className={`btn btn-secondary btn-sm${busy ? ' is-disabled' : ''}`} style={{ cursor: busy ? 'default' : 'pointer' }}>
            <Camera size={14} /> {own ? 'Take new photo' : 'Take photo'}
            <input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={chosen} />
          </label>
          <label className={`btn btn-secondary btn-sm${busy ? ' is-disabled' : ''}`} style={{ cursor: busy ? 'default' : 'pointer' }}>
            <ImagePlus size={14} /> From gallery
            <input type="file" accept="image/jpeg,image/png,image/webp,image/*" hidden disabled={busy} onChange={chosen} />
          </label>
          {own && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
              onClick={() => { if (window.confirm(`Remove the photo of ${name}?`)) void run(() => removePartPhoto(companyId, productId), `Photo of ${name} removed.`); }}>
              <Trash2 size={14} /> Remove
            </button>
          )}
        </div>
        {error && <span className="form-error" role="alert">{error}</span>}
      </div>
    </div>
  );
}
