'use client';

/**
 * A part's picture, at whatever size the screen needs: a thumbnail beside its name in a list, or
 * large when the part is opened.
 *
 * With no picture it shows an empty box rather than anything that could be mistaken for the part —
 * a camera when clicking it adds a photo, a plain box otherwise.
 */

import { Camera, Package } from 'lucide-react';

export type PartPhotoProps = {
  url?: string | null;
  name: string;
  size?: number;
  onClick?: () => void;
  /** Said on hover and read out by screen readers, since the picture is the whole button. */
  title?: string;
  /** No photo yet, and clicking adds one. */
  addable?: boolean;
  busy?: boolean;
};

export default function PartPhoto({ url, name, size = 36, onClick, title, addable, busy }: PartPhotoProps) {
  const className = 'part-photo' + (url ? '' : ' is-empty') + (busy ? ' is-busy' : '');
  const style = { width: size, height: size };
  const icon = Math.max(12, Math.round(size * 0.42));
  const inner = url
    // Plain <img>, as on the catalog admin screen: these are already-small public files, and
    // next/image would need every storage host listed in the config to show them at all.
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={url} alt={`Photo of ${name}`} loading="lazy" decoding="async" />
    : addable ? <Camera size={icon} aria-hidden="true" /> : <Package size={icon} aria-hidden="true" />;

  if (!onClick) return <span className={className} style={style} title={title}>{inner}</span>;
  return (
    <button type="button" className={className} style={style} title={title} aria-label={title} onClick={onClick} disabled={busy}>
      {inner}
    </button>
  );
}
