/**
 * An article, drawn from its text, with its uploaded photos placed after the sections they belong
 * to. Used by the public post page and by the Blog screen's preview. lib/blog.ts bodyToHtml builds
 * the same markup as a string for the website feed.
 *
 * Every piece is an ordinary React element built from lib/blog.ts parseBody, so whatever the AI or
 * anyone else typed is shown as text: there is no path by which it becomes HTML of its own. A photo
 * is drawn only from an https address (placePhotos checks it).
 */

import type { ReactNode } from 'react';
import { parseBody, placePhotos, type Inline, type PublicPhoto } from '@/lib/blog';

function InlineText({ parts }: { parts: Inline[] }): ReactNode {
  return parts.map((part, index) => {
    if (part.bold && part.italic) return <strong key={index}><em>{part.text}</em></strong>;
    if (part.bold) return <strong key={index}>{part.text}</strong>;
    if (part.italic) return <em key={index}>{part.text}</em>;
    return part.text;
  });
}

export default function BlogBody({ body, photos = [] }: { body: string; photos?: readonly PublicPhoto[] }) {
  const blocks = placePhotos(parseBody(body), photos);
  return (
    <div className="blog-body">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'h2': return <h2 key={index}><InlineText parts={block.text} /></h2>;
          case 'h3': return <h3 key={index}><InlineText parts={block.text} /></h3>;
          case 'note': return <aside key={index} className="blog-note"><InlineText parts={block.text} /></aside>;
          case 'ul': return <ul key={index}>{block.items.map((item, n) => <li key={n}><InlineText parts={item} /></li>)}</ul>;
          case 'ol': return <ol key={index}>{block.items.map((item, n) => <li key={n}><InlineText parts={item} /></li>)}</ol>;
          case 'checklist': return <ul key={index} className="blog-checklist">{block.items.map((item, n) => <li key={n}><InlineText parts={item} /></li>)}</ul>;
          // Wrapped so a wide table scrolls sideways on a phone instead of widening the page.
          case 'table': return (
            <div key={index} className="blog-table">
              <table>
                {block.head.length > 0 && <thead><tr>{block.head.map((cell, n) => <th key={n}><InlineText parts={cell} /></th>)}</tr></thead>}
                <tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, n) => <td key={n}><InlineText parts={cell} /></td>)}</tr>)}</tbody>
              </table>
            </div>
          );
          // A plain <img>, not next/image: the same markup as the website feed, and the photo was
          // already shrunk to at most 1600px when it was uploaded.
          // eslint-disable-next-line @next/next/no-img-element
          case 'photo': return <figure key={index} className="blog-photo"><img src={block.url} alt={block.alt} loading="lazy" /></figure>;
          default: return <p key={index}><InlineText parts={block.text} /></p>;
        }
      })}
    </div>
  );
}
