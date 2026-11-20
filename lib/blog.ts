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

/** A photo the post needs: where it goes, a prompt to make it with an AI image tool, its alt text,
 *  and, once the owner has uploaded it, where the photo is stored. Only the place, the alt text and
 *  the uploaded photo are ever published (publicPhotos below); the prompt never is. */
export type ImagePrompt = {
  /** Where the photo goes: "Cover photo", "After the section: <heading>" or "End of the article". */
  place: string;
  /** What to paste into the image tool. Empty for a photo the owner added of his own. */
  prompt: string;
  /** A short description of the photo, for Google and for screen readers. */
  alt: string;
  /** The uploaded photo, once there is one. */
  url?: string;
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

/** All of a post's photo prompts as one block of text, for copying in one go. Photos added
 *  without a prompt are left out. */
export function imagePromptsText(prompts: readonly ImagePrompt[]): string {
  return prompts
    .filter((item) => item.prompt)
    .map((item, index) => `${index + 1}. ${item.place}\n${item.prompt}${item.alt ? `\nAlt text: ${item.alt}` : ''}`)
    .join('\n\n');
}

/* ---------------------------------------------------------------------------------------------
 * Uploaded photos
 *
 * Each photo slot can carry an uploaded photo. The cover photo is shown under the post's title (and
 * in link previews); every other photo goes after the section its place names, or at the end of the
 * article when that section is not there any more.
 * ------------------------------------------------------------------------------------------- */

export const COVER_PLACE = 'Cover photo';
export const END_PLACE = 'End of the article';
const SECTION_PREFIX = 'After the section: ';
export const sectionPlace = (heading: string): string => `${SECTION_PREFIX}${heading}`;
export const isCoverPlace = (place: string): boolean => /^\s*cover/i.test(place);
/** How many photos one post may hold, cover included. */
export const MAX_PHOTOS = 8;

/** Only an ordinary https address may ever be drawn as a photo: never a javascript: or data:
 *  address, and nothing that could break out of an HTML attribute. */
export function isSafePhotoUrl(url: unknown): url is string {
  return typeof url === 'string' && url.length <= 600 && /^https:\/\/[^\s"'<>`\\]+$/.test(url);
}

/**
 * The photo slots as the Blog screen saves them: a slot is kept when it has a prompt or an uploaded
 * photo, an address that is not safe is dropped, and there are never more than MAX_PHOTOS. Unlike
 * cleanImagePrompts (for the AI's answer), nothing is added to the prompts here: the owner's own
 * photos have none.
 */
export function cleanPhotoSlots(raw: unknown): ImagePrompt[] {
  return list(raw)
    .map((item) => {
      const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const slot: ImagePrompt = { place: text(entry.place, 160) || END_PLACE, prompt: text(entry.prompt, 1000), alt: text(entry.alt, 160) };
      if (isSafePhotoUrl(entry.url)) slot.url = entry.url;
      return slot.prompt || slot.url ? slot : null;
    })
    .filter((item): item is ImagePrompt => item !== null)
    .slice(0, MAX_PHOTOS);
}

/**
 * A fresh set of prompts, without losing a photo already uploaded: slots that have a photo stay as
 * they are, and a new prompt is only added where no photo already fills its place. The cover comes
 * first.
 */
export function mergePromptsKeepingPhotos(current: readonly ImagePrompt[], fresh: readonly ImagePrompt[]): ImagePrompt[] {
  const kept = current.filter((slot) => slot.url);
  const filled = new Set(kept.map((slot) => (isCoverPlace(slot.place) ? COVER_PLACE : slot.place.trim().toLowerCase())));
  const added = fresh.filter((slot) => !filled.has(isCoverPlace(slot.place) ? COVER_PLACE : slot.place.trim().toLowerCase()));
  const all = [...kept, ...added];
  return [...all.filter((slot) => isCoverPlace(slot.place)), ...all.filter((slot) => !isCoverPlace(slot.place))].slice(0, MAX_PHOTOS);
}

export type PublicPhoto = { place: string; url: string; alt: string };

/**
 * What the public may see of a post's photos: the uploaded ones only, as place, address and alt
 * text. The prompts, and any slot without a photo, never leave the ERP.
 */
export function publicPhotos(raw: unknown): { cover: PublicPhoto | null; photos: PublicPhoto[] } {
  const uploaded = cleanPhotoSlots(raw)
    .filter((slot): slot is ImagePrompt & { url: string } => Boolean(slot.url))
    .map((slot) => ({ place: slot.place, url: slot.url, alt: slot.alt }));
  return {
    cover: uploaded.find((photo) => isCoverPlace(photo.place)) ?? null,
    photos: uploaded.filter((photo) => !isCoverPlace(photo.place)),
  };
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
 *   - [ ] item                               a checklist, drawn with tick boxes
 *   > text                                   a tip or a safety note, drawn as a box
 *   | a | b |  then  | --- | --- |          a table: the first row is its heading row
 *   **bold**  and  *italic*                  inside any line
 * Everything else is a paragraph. A blank line ends a paragraph, a list or a table.
 * ------------------------------------------------------------------------------------------- */

export type Inline = { text: string; bold?: boolean; italic?: boolean };

export type Block =
  | { kind: 'h2' | 'h3'; text: Inline[] }
  | { kind: 'photo'; url: string; alt: string }
  | { kind: 'p'; text: Inline[] }
  | { kind: 'note'; text: Inline[] }
  | { kind: 'ul' | 'ol' | 'checklist'; items: Inline[][] }
  /** `head` is empty for a table written without a heading row. Every row has head's width. */
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] };

/** A table is cut to this size: wider than this does not fit on a phone, longer is not a table. */
export const TABLE_MAX_COLUMNS = 5;
export const TABLE_MAX_ROWS = 30;

const TABLE_SEPARATOR = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

/** The cells of one "| a | b |" line, without the outer pipes. */
const tableCells = (line: string): string[] =>
  line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());

/** Table lines as a table block: the first line is the heading row when a separator line follows
 *  it. Separator lines are dropped, rows are padded or cut to the same width. */
function tableBlock(lines: readonly string[]): Block | null {
  const hasHead = lines.length > 1 && TABLE_SEPARATOR.test(lines[1]);
  const rowsText = lines.filter((line) => !TABLE_SEPARATOR.test(line)).map(tableCells);
  if (!rowsText.length) return null;
  const width = Math.min(TABLE_MAX_COLUMNS, Math.max(...rowsText.map((row) => row.length)));
  const shaped = rowsText.map((row) => Array.from({ length: width }, (_, index) => parseInline(row[index] ?? '')));
  const [first, ...rest] = shaped;
  return hasHead
    ? { kind: 'table', head: first, rows: rest.slice(0, TABLE_MAX_ROWS) }
    : { kind: 'table', head: [], rows: shaped.slice(0, TABLE_MAX_ROWS) };
}

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
  let listKind: 'ul' | 'ol' | 'checklist' | null = null;
  let items: Inline[][] = [];
  let note: string[] = [];
  let table: string[] = [];

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
  const flushTable = () => {
    const block = table.length ? tableBlock(table) : null;
    if (block) blocks.push(block);
    table = [];
  };
  const flushAll = () => { flushParagraph(); flushList(); flushNote(); flushTable(); };

  for (const rawLine of String(body ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) { flushAll(); continue; }

    // A line starting with "|" is a table row; the table ends at the first line that is not one.
    if (line.startsWith('|')) {
      flushParagraph();
      flushList();
      flushNote();
      table.push(line);
      continue;
    }
    flushTable();

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
      // "- [ ] item" or "- [x] item": an item of a checklist. Every box is drawn empty, to be ticked
      // by the reader at the machine.
      const box = bullet?.[1].match(/^\[[ xX]?\]\s*(.*)$/);
      const kind = box ? 'checklist' : bullet ? 'ul' : 'ol';
      if (listKind !== kind) flushList();
      listKind = kind;
      items.push(parseInline(box ? box[1] : (bullet ?? numbered)![1]));
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

const headingKey = (parts: Inline[] | string): string =>
  (typeof parts === 'string' ? parts : parts.map((part) => part.text).join('')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The places a photo can go in this article, in reading order: the cover, after each section, and
 *  at the end. For the "Where it goes" choice on the Blog screen. */
export function photoPlaces(body: string): string[] {
  const headings = parseBody(body)
    .filter((block): block is Extract<Block, { kind: 'h2' | 'h3' }> => block.kind === 'h2' || block.kind === 'h3')
    .map((block) => sectionPlace(block.text.map((part) => part.text).join('')));
  return [COVER_PLACE, ...Array.from(new Set(headings)), END_PLACE];
}

/**
 * The article's blocks with its photos placed in them: each after the section its place names
 * (after that section's last paragraph, before the next heading of the same or a higher level),
 * matched on the heading's words whatever their case or punctuation. Photos meeting at one spot keep
 * the order of the photo list. A photo whose section is not in the article, or whose place is the
 * end, goes at the end. Cover photos are left out: the page shows the cover under the title.
 */
export function placePhotos(blocks: readonly Block[], photos: readonly PublicPhoto[]): Block[] {
  const after = new Map<number, PublicPhoto[]>();
  const atEnd: PublicPhoto[] = [];
  for (const photo of photos) {
    if (isCoverPlace(photo.place) || !isSafePhotoUrl(photo.url)) continue;
    const wanted = photo.place.startsWith(SECTION_PREFIX) ? headingKey(photo.place.slice(SECTION_PREFIX.length)) : '';
    const start = wanted
      ? blocks.findIndex((block) => (block.kind === 'h2' || block.kind === 'h3') && headingKey(block.text) === wanted)
      : -1;
    if (start < 0) { atEnd.push(photo); continue; }
    const level = blocks[start].kind;
    let end = blocks.length;
    for (let index = start + 1; index < blocks.length; index += 1) {
      const kind = blocks[index].kind;
      if (kind === 'h2' || (level === 'h3' && kind === 'h3')) { end = index; break; }
    }
    after.set(end, [...(after.get(end) ?? []), photo]);
  }
  const placed: Block[] = [];
  blocks.forEach((block, index) => {
    for (const photo of after.get(index) ?? []) placed.push({ kind: 'photo', url: photo.url, alt: photo.alt });
    placed.push(block);
  });
  for (const photo of [...(after.get(blocks.length) ?? []), ...atEnd]) placed.push({ kind: 'photo', url: photo.url, alt: photo.alt });
  return placed;
}

/**
 * The article as HTML, for the website feed (/api/public/blog). The same elements, in the same
 * shape, as components/blog/BlogBody.tsx draws on the ERP's own pages, built from the same blocks.
 * Every word is escaped, so the only tags in the result are the ones written here.
 */
export function bodyToHtml(body: string, photos: readonly PublicPhoto[] = []): string {
  const html = placePhotos(parseBody(body), photos).map((block) => {
    switch (block.kind) {
      case 'photo': return `<figure class="blog-photo"><img src="${escapeHtml(block.url)}" alt="${escapeHtml(block.alt)}" loading="lazy"/></figure>`;
      case 'h2': return `<h2>${inlineHtml(block.text)}</h2>`;
      case 'h3': return `<h3>${inlineHtml(block.text)}</h3>`;
      case 'note': return `<aside class="blog-note">${inlineHtml(block.text)}</aside>`;
      case 'ul': return `<ul>${block.items.map((item) => `<li>${inlineHtml(item)}</li>`).join('')}</ul>`;
      case 'ol': return `<ol>${block.items.map((item) => `<li>${inlineHtml(item)}</li>`).join('')}</ol>`;
      case 'checklist': return `<ul class="blog-checklist">${block.items.map((item) => `<li>${inlineHtml(item)}</li>`).join('')}</ul>`;
      case 'table': return `<div class="blog-table"><table>${block.head.length ? `<thead><tr>${block.head.map((cell) => `<th>${inlineHtml(cell)}</th>`).join('')}</tr></thead>` : ''}<tbody>${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      default: return `<p>${inlineHtml(block.text)}</p>`;
    }
  }).join('');
  return `<div class="blog-body">${html}</div>`;
}

/** The article as plain words: for counting, and for a summary when none was written. */
export function plainText(body: string): string {
  return parseBody(body)
    .map((block) => {
      const words = (parts: Inline[]) => parts.map((part) => part.text).join('');
      if (block.kind === 'photo') return '';
      if (block.kind === 'table') return [block.head, ...block.rows].map((row) => row.map(words).join(' ')).join(' ');
      if ('items' in block) return block.items.map(words).join(' ');
      return words(block.text);
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const wordCount = (body: string): number => (plainText(body).match(/\S+/g) ?? []).length;

/** Minutes to read, at a steady 200 words a minute, never less than one. */
export const readMinutes = (body: string): number => Math.max(1, Math.round(wordCount(body) / 200));

/** The post's address on the company website. */
export const postUrl = (siteHost: string, slug: string): string => `https://${siteHost}/blog/${slug}`;

/** Opens WhatsApp with the post ready to send: its title, its summary and its address. The owner
 *  picks a customer, a group or a broadcast list there. */
export function whatsappShareUrl(post: { title: string; summary?: string | null; slug: string }, siteHost: string): string {
  const message = [post.title.trim(), (post.summary ?? '').trim(), postUrl(siteHost, post.slug)].filter(Boolean).join('\n\n');
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/** A draft shorter than this share of the length asked for is sent back once to be filled out. The
 *  backup AI tends to stop at about half the length asked, and thin articles do poorly on Google. */
export const SHORT_DRAFT_SHARE = 0.7;
export const isShortDraft = (body: string, wordsAsked: number): boolean => wordCount(body) < wordsAsked * SHORT_DRAFT_SHARE;

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
