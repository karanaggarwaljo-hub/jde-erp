'use client';

/**
 * "Photos for this post": the photos the article needs, each as a prompt to paste into an AI image
 * tool, with where it goes and the alt text to keep with it.
 *
 * The prompts come with the AI's first draft. After the article has been edited, or for different
 * photos, "Make new photo prompts" asks again from the article as it stands now and saves the new
 * set in place of the old. Nothing here is published.
 */

import { useState } from 'react';
import { Check, Copy, ImageIcon, RefreshCw } from 'lucide-react';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import { imagePromptsText, type ImagePrompt } from '@/lib/blog';

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

export default function BlogPhotoPrompts({ companyId, prompts, article, disabled, onReplace }: {
  companyId: string;
  prompts: ImagePrompt[];
  /** The article as it stands in the editor, saved or not: new prompts are made from this. */
  article: { title: string; body: string; machine: string };
  disabled: boolean;
  /** Saves a new set of prompts in place of the old one. */
  onReplace: (prompts: ImagePrompt[]) => Promise<void>;
}) {
  const [copied, setCopied] = useState<string>('');
  const [making, setMaking] = useState(false);
  const [error, setError] = useState('');

  const copy = async (key: string, value: string) => {
    if (await copyText(value)) {
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? '' : current)), 2000);
    } else {
      setError('Copying did not work in this browser. Select the text and copy it by hand.');
    }
  };

  const makeNew = async () => {
    if (prompts.length > 0 && !window.confirm('Make a new set of photo prompts from the article as it is now? The ones below will be replaced.')) return;
    setMaking(true);
    setError('');
    try {
      const res = await fetch('/api/ai-blog-photo-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, ...article }),
      });
      const result = (await parseJsonOrThrow(res, 'The photo prompts could not be made.')) as { image_prompts: ImagePrompt[] };
      await onReplace(result.image_prompts);
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
        {prompts.length > 1 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy('all', imagePromptsText(prompts))}>
            {copied === 'all' ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy all</>}
          </button>
        )}
      </div>
      <p className="text-sm text-muted">
        Copy a prompt into an AI image tool such as Gemini or ChatGPT to make the photo. Each one already asks for no logos or writing.
      </p>

      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      {prompts.length === 0 ? (
        <p className="text-sm text-muted">No photo prompts yet.</p>
      ) : (
        <ol className="blog-photo-list">
          {prompts.map((item, index) => {
            const key = `p${index}`;
            return (
              <li key={key}>
                <span className="blog-photo-place">{item.place}</span>
                <p className="blog-photo-prompt">{item.prompt}</p>
                <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-secondary btn-sm" aria-label={`Copy the prompt for ${item.place}`} onClick={() => void copy(key, item.prompt)}>
                    {copied === key ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy prompt</>}
                  </button>
                  {item.alt && (
                    <button type="button" className="btn btn-ghost btn-sm" aria-label={`Copy the alt text for ${item.place}`} title={item.alt} onClick={() => void copy(`${key}-alt`, item.alt)}>
                      {copied === `${key}-alt` ? <><Check size={13} /> Copied</> : 'Copy alt text'}
                    </button>
                  )}
                </div>
                {item.alt && <small className="text-muted">Alt text: {item.alt}</small>}
              </li>
            );
          })}
        </ol>
      )}

      <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} disabled={disabled || making} onClick={makeNew}>
        <RefreshCw size={13} /> {making ? 'Making photo prompts…' : prompts.length > 0 ? 'Make new photo prompts' : 'Make photo prompts'}
      </button>
    </div>
  );
}
