'use client';

/**
 * "Photos for this post": the photos the article needs, and the photos themselves once uploaded.
 *
 * Each slot is one photo: where it goes, a prompt to make it with an AI image tool, its alt text, a
 * Generate photo button that makes it here from the prompt (app/api/ai-blog-photo-generate), and an
 * Upload button for a photo made elsewhere. "Make all photos" makes every missing one in turn. The
 * cover photo is shown under the post's title and in link previews; every other photo goes after
 * the section chosen in "Where it goes". A real photo the owner already has can be added with
 * "Add your own photo", with no prompt at all.
 *
 * The prompts come with the AI's first draft. "Make new photo prompts" asks again from the article
 * as it stands, and keeps every photo already uploaded (lib/blog.ts mergePromptsKeepingPhotos).
 * Every change here is saved straight away through `onReplace`. Only uploaded photos and their alt
 * text are ever published; the prompts never are.
 */

import { useRef, useState } from 'react';
import { Check, Copy, ImageIcon, ImagePlus, RefreshCw, Sparkles, Trash2, Upload } from 'lucide-react';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import { resizeImageForUpload } from '@/lib/imageResize';
import {
  COVER_PLACE,
  END_PLACE,
  MAX_PHOTOS,
  cleanPhotoSlots,
  imagePromptsText,
  isCoverPlace,
  mergePromptsKeepingPhotos,
  photoPlaces,
  type ImagePrompt,
} from '@/lib/blog';

/** Copies text, falling back to a hidden text box where the clipboard API is not allowed (an
 *  older browser, or a page not served over HTTPS). */
async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const box = document.createElement('textarea');
    box.value = value;
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand('copy');
    box.remove();
    return ok;
  }
}

/** Shrinks the chosen photo in the browser and stores it; answers with its public address. */
async function uploadPhoto(postId: string, file: File): Promise<string> {
  const { base64, mimeType } = await resizeImageForUpload(file);
  const res = await fetch('/api/blog-photo-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postId, base64, mimeType }),
  });
  const result = (await parseJsonOrThrow(res, 'The photo was not uploaded.')) as { url: string };
  return result.url;
}

/** Makes the photo from its prompt on the server, stores it, and answers with its public address. */
async function generatePhoto(postId: string, slot: ImagePrompt): Promise<string> {
  const res = await fetch('/api/ai-blog-photo-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postId, prompt: slot.prompt, place: slot.place }),
  });
  const result = (await parseJsonOrThrow(res, 'The photo could not be made.')) as { url: string };
  return result.url;
}

const NEW_SLOT = -1;

export default function BlogPhotoPrompts({ postId, companyId, prompts, article, disabled, onReplace }: {
  postId: string;
  companyId: string;
  prompts: ImagePrompt[];
  /** The article as it stands in the editor, saved or not: new prompts and the places a photo can go
   *  are worked out from this. */
  article: { title: string; body: string; machine: string };
  disabled: boolean;
  /** Saves the photo slots in place of the old ones. */
  onReplace: (prompts: ImagePrompt[]) => Promise<void>;
}) {
  const [copied, setCopied] = useState('');
  const [making, setMaking] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  // The slot whose photo is being made, and how far "Make all photos" has got.
  const [generating, setGenerating] = useState<number | null>(null);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  // Alt text being typed, by slot, saved when the box is left.
  const [altDrafts, setAltDrafts] = useState<Record<number, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<number>(NEW_SLOT);

  const places = photoPlaces(article.body);
  const busy = disabled || making || uploading !== null || generating !== null;
  const missing = prompts.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot.prompt && !slot.url);
  const hasCover = prompts.some((slot) => isCoverPlace(slot.place) && slot.url);
  const promptCount = prompts.filter((slot) => slot.prompt).length;

  const save = async (next: ImagePrompt[]) => {
    setError('');
    try {
      await onReplace(cleanPhotoSlots(next));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That was not saved.');
    }
  };

  const change = (index: number, patch: Partial<ImagePrompt>) =>
    save(prompts.map((slot, n) => (n === index ? { ...slot, ...patch } : slot)));

  const copy = async (key: string, value: string) => {
    if (await copyText(value)) {
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? '' : current)), 2000);
    } else {
      setError('Copying did not work in this browser. Select the text and copy it by hand.');
    }
  };

  const pickFile = (index: number) => {
    uploadTarget.current = index;
    setError('');
    fileInput.current?.click();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const index = uploadTarget.current;
    setUploading(index);
    setError('');
    try {
      const url = await uploadPhoto(postId, file);
      if (index === NEW_SLOT) {
        // A photo of the owner's own: it goes at the end until he chooses a section, or on top
        // as the cover when the post has none yet.
        await save([...prompts, { place: hasCover ? END_PLACE : COVER_PLACE, prompt: '', alt: '', url }]);
      } else {
        await save(prompts.map((slot, n) => (n === index ? { ...slot, url } : slot)));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The photo was not uploaded.');
    } finally {
      setUploading(null);
    }
  };

  /** Makes one slot's photo from its prompt and saves it into a copy of the slots, which is returned
   *  so "Make all photos" can carry on from it. */
  const generateInto = async (slots: ImagePrompt[], index: number): Promise<ImagePrompt[]> => {
    setGenerating(index);
    const url = await generatePhoto(postId, slots[index]);
    const next = slots.map((slot, n) => (n === index ? { ...slot, url } : slot));
    await onReplace(cleanPhotoSlots(next));
    return next;
  };

  const generate = async (index: number) => {
    if (prompts[index]?.url && !window.confirm('Make a new photo in place of this one?')) return;
    setError('');
    try {
      await generateInto(prompts, index);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The photo could not be made.');
    } finally {
      setGenerating(null);
    }
  };

  const generateAll = async () => {
    const todo = missing.map(({ index }) => index);
    if (!todo.length) return;
    setError('');
    let slots = [...prompts];
    try {
      for (const [done, index] of todo.entries()) {
        setBatch({ done, total: todo.length });
        slots = await generateInto(slots, index);
      }
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : 'A photo could not be made.'} The photos made so far are saved.`);
    } finally {
      setGenerating(null);
      setBatch(null);
    }
  };

  const remove = (index: number) => {
    const slot = prompts[index];
    if (!slot) return;
    if (!window.confirm(slot.prompt ? 'Take this photo out of the post? Its prompt stays, so you can upload another.' : 'Take this photo out of the post?')) return;
    // A slot with a prompt keeps it; one of the owner's own photos goes altogether.
    void save(slot.prompt ? prompts.map((item, n) => (n === index ? { ...item, url: undefined } : item)) : prompts.filter((_, n) => n !== index));
  };

  const makeNew = async () => {
    const uploaded = prompts.filter((slot) => slot.url).length;
    if (prompts.length > 0 && !window.confirm(uploaded > 0
      ? 'Make new photo prompts from the article as it is now? The photos you uploaded stay; only the prompts without a photo are replaced.'
      : 'Make a new set of photo prompts from the article as it is now? The ones below will be replaced.')) return;
    setMaking(true);
    setError('');
    try {
      const res = await fetch('/api/ai-blog-photo-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, ...article }),
      });
      const result = (await parseJsonOrThrow(res, 'The photo prompts could not be made.')) as { image_prompts: ImagePrompt[] };
      await onReplace(mergePromptsKeepingPhotos(prompts, result.image_prompts));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The photo prompts could not be made.');
    } finally {
      setMaking(false);
    }
  };

  return (
    <div className="card blog-photos">
      <div className="flex items-center justify-between" style={{ gap: '8px' }}>
        <strong className="flex items-center gap-2"><ImageIcon size={16} aria-hidden="true" /> Photos for this post</strong>
        {promptCount > 1 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy('all', imagePromptsText(prompts))}>
            {copied === 'all' ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy all</>}
          </button>
        )}
      </div>
      <p className="text-sm text-muted">
        Press <strong>Generate photo</strong> and the AI makes it here from its prompt, in about half a minute. Or make it in another app and press <strong>Upload photo</strong>. Each photo goes into the post where it says.
      </p>
      {missing.length > 1 && (
        <button type="button" className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => void generateAll()}>
          <Sparkles size={13} /> {batch ? `Making photo ${batch.done + 1} of ${batch.total}…` : `Make all ${missing.length} photos`}
        </button>
      )}

      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      {prompts.length === 0 ? (
        <p className="text-sm text-muted">No photos yet.</p>
      ) : (
        <ol className="blog-photo-list">
          {prompts.map((slot, index) => {
            const key = `p${index}`;
            const placeOptions = places.includes(slot.place) ? places : [...places, slot.place];
            return (
              <li key={key}>
                <label className="blog-photo-place-pick">
                  <span className="sr-only">Where photo {index + 1} goes</span>
                  <select className="form-input form-select" value={slot.place} disabled={busy} onChange={(event) => void change(index, { place: event.target.value })}>
                    {placeOptions.map((place) => (
                      <option key={place} value={place}>{place}{!places.includes(place) ? ' (section not found: goes at the end)' : ''}</option>
                    ))}
                  </select>
                </label>

                {slot.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="blog-photo-thumb" src={slot.url} alt={slot.alt || 'Uploaded photo'} />
                ) : slot.prompt ? (
                  <p className="blog-photo-prompt">{slot.prompt}</p>
                ) : null}

                {generating === index && <p className="text-sm text-muted" role="status">Making the photo. This takes about half a minute…</p>}

                <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                  {slot.prompt && !slot.url && (
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void generate(index)}>
                      <Sparkles size={13} /> {generating === index ? 'Making…' : 'Generate photo'}
                    </button>
                  )}
                  {slot.url ? (
                    <>
                      {slot.prompt && (
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} aria-label={`Generate photo ${index + 1} again`} onClick={() => void generate(index)}>
                          <Sparkles size={13} /> {generating === index ? 'Making…' : 'Generate again'}
                        </button>
                      )}
                      <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => pickFile(index)}>
                        <Upload size={13} /> {uploading === index ? 'Uploading…' : 'Replace photo'}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} disabled={busy} aria-label={`Remove photo ${index + 1}`} onClick={() => remove(index)}>
                        <Trash2 size={13} /> Remove
                      </button>
                    </>
                  ) : (
                    <button type="button" className={`btn ${slot.prompt ? 'btn-secondary' : 'btn-primary'} btn-sm`} disabled={busy} onClick={() => pickFile(index)}>
                      <Upload size={13} /> {uploading === index ? 'Uploading…' : 'Upload photo'}
                    </button>
                  )}
                  {slot.prompt && (
                    <button type="button" className="btn btn-ghost btn-sm" aria-label={`Copy the prompt for ${slot.place}`} onClick={() => void copy(key, slot.prompt)}>
                      {copied === key ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy prompt</>}
                    </button>
                  )}
                </div>

                <label className="blog-photo-alt">
                  <span>Alt text <span className="text-muted">(what the photo shows, for Google)</span></span>
                  <input className="form-input" maxLength={160} disabled={busy} value={altDrafts[index] ?? slot.alt}
                    onChange={(event) => setAltDrafts((current) => ({ ...current, [index]: event.target.value }))}
                    onBlur={() => {
                      const typed = altDrafts[index];
                      setAltDrafts((current) => { const next = { ...current }; delete next[index]; return next; });
                      if (typed !== undefined && typed.trim() !== slot.alt) void change(index, { alt: typed.trim() });
                    }} />
                </label>
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy || prompts.length >= MAX_PHOTOS} onClick={() => pickFile(NEW_SLOT)}
          title={prompts.length >= MAX_PHOTOS ? `A post can have up to ${MAX_PHOTOS} photos` : 'A real photo you already have, such as one of a part in your shop'}>
          <ImagePlus size={13} /> {uploading === NEW_SLOT ? 'Uploading…' : 'Add your own photo'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={makeNew}>
          <RefreshCw size={13} /> {making ? 'Making photo prompts…' : promptCount > 0 ? 'Make new photo prompts' : 'Make photo prompts'}
        </button>
      </div>

      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/*" hidden
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void onFile(file); }} />
    </div>
  );
}
