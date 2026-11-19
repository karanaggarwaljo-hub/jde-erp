/**
 * The blog: articles for the company website about backhoe loaders, rock breakers and excavators.
 *
 * The owner wanted something that writes new posts on every topic around these machines. The Blog
 * screen offers a bank of topics (below), asks the AI to draft one (app/api/ai-blog-draft), and the
 * owner reads it, changes what he wants, and publishes it. Nothing here touches the database: this
 * is what the screen, the AI route and the public pages decide with, kept pure so it can be tested.
 *
 *   TOPICS             the topic bank, by machine, so "every topic" is a list that can be worked
 *                      through, with what is already written ticked off
 *   slugify/uniqueSlug the post's web address
 *   cleanDraft         what the AI sends back, trimmed and capped before it is ever saved
 *   parseBody          the article text, read as a small Markdown subset into blocks that are drawn
 *                      as plain React elements: nothing the AI writes is ever inserted as HTML
 */

export type Machine = 'backhoe' | 'breaker' | 'excavator' | 'general';

export const MACHINES: ReadonlyArray<{ id: Machine; label: string; hint: string }> = [
  { id: 'backhoe', label: 'Backhoe loader', hint: 'JCB 3DX and other backhoe loaders' },
  { id: 'breaker', label: 'Rock breaker', hint: 'Hydraulic breakers, chisels, bushes, seals' },
  { id: 'excavator', label: 'Excavator', hint: 'Crawler excavators and their undercarriage' },
  { id: 'general', label: 'Parts & general', hint: 'Buying parts, oils, filters, downtime' },
];

export const machineLabel = (machine: string): string => MACHINES.find((entry) => entry.id === machine)?.label ?? 'General';

export function isMachine(value: unknown): value is Machine {
  return typeof value === 'string' && MACHINES.some((entry) => entry.id === value);
}

export type Topic = { id: string; machine: Machine; title: string };

/**
 * Practical questions an operator, a mechanic or a machine owner in India actually asks. Each is a
 * starting point for the AI, not a fixed headline: it writes its own title.
 *
 * Worded so that no topic asks for a figure the AI could only invent (a pressure, a torque, a
 * service interval): those depend on the exact machine and are left to its manual.
 */
export const TOPICS: readonly Topic[] = [
  // Backhoe loaders
  { id: 'bh-daily-checks', machine: 'backhoe', title: 'Daily checks before starting a JCB 3DX backhoe loader' },
  { id: 'bh-greasing', machine: 'backhoe', title: 'Greasing a backhoe loader: every point, and why it cannot be skipped' },
  { id: 'bh-slow-hydraulics', machine: 'backhoe', title: 'Why the hydraulics of a backhoe loader feel slow or weak, and how to find the cause' },
  { id: 'bh-overheating', machine: 'backhoe', title: 'Backhoe loader engine overheating in Indian summers: causes and fixes' },
  { id: 'bh-oil-filters', machine: 'backhoe', title: 'Choosing the right engine oil and filters for a backhoe loader' },
  { id: 'bh-bucket-teeth', machine: 'backhoe', title: 'When to replace backhoe bucket teeth and side cutters' },
  { id: 'bh-pins-bushes', machine: 'backhoe', title: 'Backhoe loader pins and bushes: signs of wear and what wear costs you' },
  { id: 'bh-hoses', machine: 'backhoe', title: 'Preventing burst hydraulic hoses on a backhoe loader' },
  { id: 'bh-transmission', machine: 'backhoe', title: 'Early warning signs of transmission and brake trouble in a backhoe loader' },
  { id: 'bh-monsoon', machine: 'backhoe', title: 'Getting a backhoe loader ready for, and through, the monsoon' },
  { id: 'bh-air-filter', machine: 'backhoe', title: 'Air filter care for backhoe loaders working in dust' },
  { id: 'bh-diesel', machine: 'backhoe', title: 'Bad diesel and water in fuel: protecting a backhoe loader fuel system' },
  { id: 'bh-tyres', machine: 'backhoe', title: 'Backhoe loader tyres: pressure, wear and when to replace them' },
  { id: 'bh-battery', machine: 'backhoe', title: 'Battery and starting problems in backhoe loaders' },
  { id: 'bh-swing-stabiliser', machine: 'backhoe', title: 'Backhoe swing and stabiliser problems: what to check first' },
  { id: 'bh-used-3dx', machine: 'backhoe', title: 'Buying a used JCB 3DX: what to inspect before you pay' },
  { id: 'bh-running-cost', machine: 'backhoe', title: 'Practical ways to cut the running cost of a backhoe loader' },
  { id: 'bh-service-plan', machine: 'backhoe', title: 'Planned servicing for a backhoe loader: what each service usually includes' },
  // Rock breakers
  { id: 'rb-how-it-works', machine: 'breaker', title: 'How a hydraulic rock breaker works, in simple words' },
  { id: 'rb-choosing', machine: 'breaker', title: 'Choosing the right rock breaker for a backhoe loader or excavator' },
  { id: 'rb-chisel-types', machine: 'breaker', title: 'Rock breaker chisel types (moil, blunt, wedge) and when to use each' },
  { id: 'rb-chisel-breaks', machine: 'breaker', title: 'Why rock breaker chisels break, and how to make them last longer' },
  { id: 'rb-greasing', machine: 'breaker', title: 'Greasing a rock breaker chisel the right way' },
  { id: 'rb-bushes', machine: 'breaker', title: 'Rock breaker bushes: checking wear and when to replace them' },
  { id: 'rb-nitrogen', machine: 'breaker', title: 'Nitrogen gas in a rock breaker: why it matters and signs it is low' },
  { id: 'rb-weak-hits', machine: 'breaker', title: 'Rock breaker hitting weak or not hitting at all: common causes' },
  { id: 'rb-blank-firing', machine: 'breaker', title: 'Blank firing: what it is and why it damages rock breakers' },
  { id: 'rb-seal-kit', machine: 'breaker', title: 'Rock breaker seal kits: signs a reseal is due' },
  { id: 'rb-piping-kit', machine: 'breaker', title: 'Hose and piping kits for fitting a rock breaker to a backhoe loader' },
  { id: 'rb-technique', machine: 'breaker', title: 'Operating a rock breaker correctly: angle, down pressure and time per spot' },
  { id: 'rb-storage', machine: 'breaker', title: 'Storing a rock breaker when it is not in use' },
  { id: 'rb-bolts', machine: 'breaker', title: 'Through bolts and side bolts on a rock breaker: why they loosen and how to check' },
  // Excavators
  { id: 'ex-daily-checks', machine: 'excavator', title: 'Daily walk-around checks for a crawler excavator' },
  { id: 'ex-track-tension', machine: 'excavator', title: 'Excavator undercarriage care: track tension, rollers and idlers' },
  { id: 'ex-track-wear', machine: 'excavator', title: 'Excavator track chains and sprockets: reading wear and when to replace' },
  { id: 'ex-swing', machine: 'excavator', title: 'Excavator swing motor and slew ring: signs of trouble' },
  { id: 'ex-pump', machine: 'excavator', title: 'Excavator hydraulic pump problems: symptoms and causes' },
  { id: 'ex-bucket-teeth', machine: 'excavator', title: 'Excavator bucket teeth and adapters: choosing and replacing them' },
  { id: 'ex-cooling', machine: 'excavator', title: 'Keeping an excavator cooling system healthy' },
  { id: 'ex-no-start', machine: 'excavator', title: 'Excavator engine will not start: a step-by-step checklist' },
  { id: 'ex-electrical', machine: 'excavator', title: 'Excavator electrical faults: fuses, sensors and wiring' },
  { id: 'ex-final-drive', machine: 'excavator', title: 'Excavator final drive leaks and noises' },
  { id: 'ex-boom-pins', machine: 'excavator', title: 'Excavator boom and arm pins: wear, play and repair' },
  { id: 'ex-mud-water', machine: 'excavator', title: 'Working an excavator in mud and water without damaging it' },
  // Parts and general
  { id: 'gn-genuine', machine: 'general', title: 'Genuine and aftermarket spare parts: what really matters' },
  { id: 'gn-part-number', machine: 'general', title: 'How to find the right part number for your machine' },
  { id: 'gn-stock-spares', machine: 'general', title: 'Spare parts every earthmoving contractor should keep in stock' },
  { id: 'gn-hydraulic-oil', machine: 'general', title: 'Hydraulic oil: keeping it clean and knowing when to change it' },
  { id: 'gn-filters', machine: 'general', title: 'Engine oil, fuel, hydraulic and air filters explained' },
  { id: 'gn-downtime', machine: 'general', title: 'Reducing machine downtime on construction sites' },
];

export const topicById = (id: string | null | undefined): Topic | undefined => TOPICS.find((topic) => topic.id === id);

/** The topics of one machine, those not yet written first, each marked with whether it has been. */
export function topicsFor(machine: Machine, writtenTopicIds: ReadonlySet<string>): Array<Topic & { written: boolean }> {
  return TOPICS
    .filter((topic) => topic.machine === machine)
    .map((topic) => ({ ...topic, written: writtenTopicIds.has(topic.id) }))
    .sort((a, b) => Number(a.written) - Number(b.written));
}

/** How much of the topic bank has a post, draft or published. */
export function topicCoverage(writtenTopicIds: ReadonlySet<string>): { written: number; total: number } {
  return { written: TOPICS.filter((topic) => writtenTopicIds.has(topic.id)).length, total: TOPICS.length };
}

/* ---------------------------------------------------------------------------------------------
 * Web addresses
 * ------------------------------------------------------------------------------------------- */

export const SLUG_MAX = 80;
/** How long a web address made from a title may be. Short addresses read better when shared and in
 *  search results; one typed by hand may use up to SLUG_MAX. */
export const SLUG_FROM_TITLE = 60;

/** "Rock Breaker Chisel: Moil vs Blunt?" -> "rock-breaker-chisel-moil-vs-blunt". Letters and digits
 *  only (accents dropped), joined by single hyphens, cut at a word boundary. */
export function slugify(text: string, max: number = SLUG_FROM_TITLE): string {
  const words = String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let slug = '';
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > max) break;
    slug = next;
  }
  return slug || (words[0] ?? '').slice(0, max) || 'post';
}

/** A web address no other post of this company has: the plain one, or the plain one with -2, -3… */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = slugify(base);
  if (!used.has(root)) return root;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${root.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

export const isValidSlug = (slug: string): boolean => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length <= SLUG_MAX;

/* ---------------------------------------------------------------------------------------------
 * What the AI sends back
 * ------------------------------------------------------------------------------------------- */

export type FaqItem = { question: string; answer: string };

const text = (value: unknown, max: number): string =>
  (typeof value === 'string' ? value : '').replace(/\s+/g, ' ').trim().slice(0, max);

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** A photo the post needs, described so it can be made with an AI image tool. Never published:
 *  the owner copies the prompt, makes the photo, and keeps the alt text to describe it. */
export type ImagePrompt = {
  /** Where the photo goes: "Cover photo", or after which section. */
  place: string;
  /** What to paste into the image tool. */
  prompt: string;
  /** A short description of the finished photo, for Google and for screen readers. */
  alt: string;
};

export type BlogDraft = {
  title: string;
  summary: string;
  body: string;
  faq: FaqItem[];
  tags: string[];
  fact_checks: string[];
  image_prompts: ImagePrompt[];
};

/** Added to every photo prompt by the ERP, whatever the AI wrote, so a photo can never show a
 *  maker's logo or badge (the shop does not own them, and a made-up logo misleads), or garbled text,
 *  which image tools are prone to. */
export const PHOTO_PROMPT_RULES = 'No logos, no brand names, no badges and no writing anywhere in the image.';

/** The AI's photo prompts, trimmed, capped, and each one ending with PHOTO_PROMPT_RULES. A prompt
 *  with no words is dropped; a missing place or alt text is filled in plainly rather than left blank. */
export function cleanImagePrompts(raw: unknown): ImagePrompt[] {
  return list(raw)
    .map((item, index) => {
      const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const prompt = text(entry.prompt, 900);
      if (!prompt) return null;
      const withRules = prompt.toLowerCase().includes('no logos') ? prompt : `${prompt.replace(/[.\s]+$/, '')}. ${PHOTO_PROMPT_RULES}`;
      return {
        place: text(entry.place, 120) || (index === 0 ? 'Cover photo' : `Photo ${index + 1}`),
        prompt: withRules,
        alt: text(entry.alt, 160),
      };
    })
    .filter((item): item is ImagePrompt => item !== null)
    .slice(0, 5);
}

/** All of a post's photo prompts as one block of text, for copying in one go. */
export function imagePromptsText(prompts: readonly ImagePrompt[]): string {
  return prompts.map((item, index) => `${index + 1}. ${item.place}\n${item.prompt}${item.alt ? `\nAlt text: ${item.alt}` : ''}`).join('\n\n');
}

export const TITLE_MAX = 110;
export const SUMMARY_MAX = 300;
/** What search engines show of a title and a summary before cutting it off. A hint, not a limit. */
export const TITLE_SHOWN = 60;
export const SUMMARY_SHOWN = 160;


/**
 * The AI's answer made safe to save: every field present and the right type, each capped to what
 * the table allows, and the article's own top heading dropped (the title is already the heading).
 * Anything missing comes back empty rather than undefined, so a half answer can still be edited.
 */
export function cleanDraft(raw: unknown): BlogDraft {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const title = text(value.title, TITLE_MAX);
  const body = (typeof value.body === 'string' ? value.body : '')
    .replace(/\r\n?/g, '\n')
    // A first line that is the title again, as a "# Title" heading or plain.
    .replace(/^\s*#\s+[^\n]*\n+/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 30000);
  const faq = list(value.faq)
    .map((item) => {
      const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      return { question: text(entry.question, 200), answer: text(entry.answer, 1200) };
    })
    .filter((item) => item.question && item.answer)
    .slice(0, 8);
  const tags = Array.from(new Set(list(value.tags).map((tag) => text(tag, 40).toLowerCase()).filter(Boolean))).slice(0, 8);
  const factChecks = list(value.fact_checks).map((item) => text(item, 300)).filter(Boolean).slice(0, 12);
  return { title, summary: text(value.summary, SUMMARY_MAX), body, faq, tags, fact_checks: factChecks, image_prompts: cleanImagePrompts(value.image_prompts) };
}

/** Lengths the writer offers, with the word count asked of the AI. */
export const LENGTHS = [
  { id: 'short', label: 'Short', words: 600, hint: 'About 600 words, a 3 minute read' },
  { id: 'standard', label: 'Standard', words: 1000, hint: 'About 1,000 words, a 5 minute read' },
  { id: 'long', label: 'Long', words: 1500, hint: 'About 1,500 words, a 7 minute read' },
] as const;
export type LengthId = (typeof LENGTHS)[number]['id'];
export const lengthWords = (id: unknown): number => (LENGTHS.find((entry) => entry.id === id) ?? LENGTHS[1]).words;

/* ---------------------------------------------------------------------------------------------
 * Reading the article
 *
 * A small Markdown subset, enough for a practical article and nothing that can carry markup:
 *   ## Heading  /  ### Smaller heading      (a single # is read as ##: the title is the only h1)
 *   - item  or  * item                       a bulleted list
 *   1. item                                  a numbered list
 *   > text                                   a tip or a safety note, drawn as a box
 *   **bold**  and  *italic*                  inside any line
 * Everything else is a paragraph. A blank line ends a paragraph or a list.
 * ------------------------------------------------------------------------------------------- */

export type Inline = { text: string; bold?: boolean; italic?: boolean };

export type Block =
  | { kind: 'h2' | 'h3'; text: Inline[] }
  | { kind: 'p'; text: Inline[] }
  | { kind: 'note'; text: Inline[] }
  | { kind: 'ul' | 'ol'; items: Inline[][] };

/** **bold** and *italic* within one line. Unclosed markers are left as the characters they are. */
export function parseInline(line: string): Inline[] {
  const parts: Inline[] = [];
  const pattern = /\*\*([^*]+?)\*\*|\*([^*\s][^*]*?)\*/g;
  let last = 0;
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    if (match.index > last) parts.push({ text: line.slice(last, match.index) });
    if (match[1] !== undefined) parts.push({ text: match[1], bold: true });
    else parts.push({ text: match[2], italic: true });
    last = match.index + match[0].length;
  }
  if (last < line.length) parts.push({ text: line.slice(last) });
  return parts.filter((part) => part.text);
}

export function parseBody(body: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let listKind: 'ul' | 'ol' | null = null;
  let items: Inline[][] = [];
  let note: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'p', text: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };
  const flushList = () => {
    if (listKind && items.length) blocks.push({ kind: listKind, items });
    listKind = null;
    items = [];
  };
  const flushNote = () => {
    if (note.length) blocks.push({ kind: 'note', text: parseInline(note.join(' ')) });
    note = [];
  };
  const flushAll = () => { flushParagraph(); flushList(); flushNote(); };

  for (const rawLine of String(body ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) { flushAll(); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length >= 3 ? 'h3' : 'h2';
      blocks.push({ kind: level, text: parseInline(heading[2].replace(/\s*#+\s*$/, '')) });
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushParagraph();
      flushNote();
      const kind = bullet ? 'ul' : 'ol';
      if (listKind !== kind) flushList();
      listKind = kind;
      items.push(parseInline((bullet ?? numbered)![1]));
      continue;
    }
    const quoted = line.match(/^>\s?(.*)$/);
    if (quoted) {
      flushParagraph();
      flushList();
      if (quoted[1]) note.push(quoted[1]);
      continue;
    }
    // A line under a list item with no marker carries on that item.
    if (listKind && items.length) {
      items[items.length - 1] = [...items[items.length - 1], { text: ' ' }, ...parseInline(line)];
      continue;
    }
    flushNote();
    paragraph.push(line);
  }
  flushAll();
  return blocks;
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function inlineHtml(parts: Inline[]): string {
  return parts.map((part) => {
    const text = escapeHtml(part.text);
    if (part.bold && part.italic) return `<strong><em>${text}</em></strong>`;
    if (part.bold) return `<strong>${text}</strong>`;
    if (part.italic) return `<em>${text}</em>`;
    return text;
  }).join('');
}

/**
 * The article as HTML, for the website feed (/api/public/blog). The same elements, in the same
 * shape, as components/blog/BlogBody.tsx draws on the ERP's own pages, built from the same blocks.
 * Every word is escaped, so the only tags in the result are the ones written here.
 */
export function bodyToHtml(body: string): string {
  const html = parseBody(body).map((block) => {
    switch (block.kind) {
      case 'h2': return `<h2>${inlineHtml(block.text)}</h2>`;
      case 'h3': return `<h3>${inlineHtml(block.text)}</h3>`;
      case 'note': return `<aside class="blog-note">${inlineHtml(block.text)}</aside>`;
      case 'ul': return `<ul>${block.items.map((item) => `<li>${inlineHtml(item)}</li>`).join('')}</ul>`;
      case 'ol': return `<ol>${block.items.map((item) => `<li>${inlineHtml(item)}</li>`).join('')}</ol>`;
      default: return `<p>${inlineHtml(block.text)}</p>`;
    }
  }).join('');
  return `<div class="blog-body">${html}</div>`;
}

/** The article as plain words: for counting, and for a summary when none was written. */
export function plainText(body: string): string {
  return parseBody(body)
    .map((block) => ('items' in block ? block.items.map((item) => item.map((part) => part.text).join('')).join(' ') : block.text.map((part) => part.text).join('')))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const wordCount = (body: string): number => (plainText(body).match(/\S+/g) ?? []).length;

/** Minutes to read, at a steady 200 words a minute, never less than one. */
export const readMinutes = (body: string): number => Math.max(1, Math.round(wordCount(body) / 200));

/** Tags typed in one box, separated by commas, as they will be saved. */
export function splitTags(typed: string): string[] {
  return Array.from(new Set(typed.split(',').map((tag) => tag.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean))).slice(0, 8);
}

/** Why a post cannot even be saved as a draft: it needs a title and a web address of its own. A
 *  draft may otherwise be short or unfinished. */
export function saveProblems(post: { title: string; slug: string }, otherSlugs: Iterable<string>): string[] {
  const problems: string[] = [];
  if (!post.title.trim()) problems.push('Give the post a title.');
  if (!isValidSlug(post.slug)) problems.push('The web address can only have small letters, numbers and hyphens.');
  else if (new Set(otherSlugs).has(post.slug)) problems.push('Another post already uses this web address. Change it a little.');
  return problems;
}

/** Why a post cannot be published as it stands, or an empty list when it can. */
export function publishProblems(post: { title: string; slug: string; body: string; summary: string }, otherSlugs: Iterable<string>): string[] {
  const problems = saveProblems(post, otherSlugs);
  if (wordCount(post.body) < 150) problems.push('The article is very short. Write at least a few paragraphs.');
  if (!post.summary.trim()) problems.push('Write a one or two line summary. Google shows it under the title.');
  return problems;
}
