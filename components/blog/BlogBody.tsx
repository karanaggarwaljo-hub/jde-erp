/**
 * An article, drawn from its text. Used by the public post page, by the Blog screen's preview, and
 * (rendered to a string) by /api/public/blog for the website.
 *
 * Every piece is an ordinary React element built from lib/blog.ts parseBody, so whatever the AI or
 * anyone else typed is shown as text: there is no path by which it becomes HTML of its own.
 */

import type { ReactNode } from 'react';
import { parseBody, type Inline } from '@/lib/blog';

function InlineText({ parts }: { parts: Inline[] }): ReactNode {
  return parts.map((part, index) => {
    if (part.bold && part.italic) return <strong key={index}><em>{part.text}</em></strong>;
    if (part.bold) return <strong key={index}>{part.text}</strong>;
    if (part.italic) return <em key={index}>{part.text}</em>;
    return part.text;
  });
}

export default function BlogBody({ body }: { body: string }) {
  const blocks = parseBody(body);
  return (
    <div className="blog-body">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'h2': return <h2 key={index}><InlineText parts={block.text} /></h2>;
          case 'h3': return <h3 key={index}><InlineText parts={block.text} /></h3>;
          case 'note': return <aside key={index} className="blog-note"><InlineText parts={block.text} /></aside>;
          case 'ul': return <ul key={index}>{block.items.map((item, n) => <li key={n}><InlineText parts={item} /></li>)}</ul>;
          case 'ol': return <ol key={index}>{block.items.map((item, n) => <li key={n}><InlineText parts={item} /></li>)}</ol>;
          default: return <p key={index}><InlineText parts={block.text} /></p>;
        }
      })}
    </div>
  );
}
