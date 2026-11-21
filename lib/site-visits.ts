/**
 * Website visits: how many people open each page of the company website (jd-enterprise.com), and
 * which pages lead to a WhatsApp message, a call or a share. Built into the ERP at the owner's
 * choice (November 2026) instead of an outside analytics service: no account, no cookies, and
 * nothing about a visitor is kept, only a count per page, per day.
 *
 * The website sends each page view and each tap (its visit.js, through its own /api/visit) to
 * /api/public/site-hit, which adds one to that page's count for the day (jde_site_hit in
 * scripts/site-visits.sql). The Website visits screen reads the counts back through
 * /api/site-visits, summed by summarizeVisits below.
 *
 * Everything here is pure, so what is accepted and how it is counted is tested directly.
 */

export const SITE_KINDS = ['view', 'whatsapp', 'call', 'share'] as const;
export type SiteKind = (typeof SITE_KINDS)[number];

export const SITE_SOURCES = ['direct', 'google', 'search', 'whatsapp', 'social', 'site', 'other'] as const;
export type SiteSource = (typeof SITE_SOURCES)[number];

export const SOURCE_LABELS: Record<SiteSource, string> = {
  direct: 'Typed in, or opened from an app',
  google: 'Google search',
  search: 'Other search engines',
  whatsapp: 'WhatsApp',
  social: 'Facebook, Instagram, YouTube and others',
  site: 'Another page of your website',
  other: 'Other websites',
};

export type SiteHit = { path: string; kind: SiteKind; source: SiteSource | '' };

const PATH_PATTERN = /^\/[a-z0-9/._-]{0,160}$/;

/** The page's address, tidied: no query or #part, lower case, no trailing slash. '' if it is not an
 *  address the website could have, which is how made-up or hostile ones are turned away. */
export function normalizePath(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let path = raw.trim().split(/[?#]/)[0].toLowerCase();
  if (path.length > 1) path = path.replace(/\/+$/, '');
  if (!PATH_PATTERN.test(path)) return '';
  if (path.includes('//') || path.includes('..') || path.startsWith('/api/') || path === '/api') return '';
  return path;
}

const host = (referrer: string): string => {
  try {
    return new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** Where a page view came from, in a handful of plain groups, from the page that linked to it. */
export function sourceOf(referrer: unknown, siteHost = 'jd-enterprise.com'): SiteSource {
  const from = typeof referrer === 'string' ? host(referrer) : '';
  if (!from) return 'direct';
  if (from === siteHost || from.endsWith(`.${siteHost}`)) return 'site';
  if (/(^|\.)google\.[a-z.]+$/.test(from)) return 'google';
  if (/(^|\.)(bing\.com|duckduckgo\.com|yahoo\.com|yandex\.[a-z.]+|ecosia\.org|baidu\.com)$/.test(from)) return 'search';
  if (/(^|\.)(whatsapp\.com|whatsapp\.net|wa\.me|l\.wl\.co)$/.test(from)) return 'whatsapp';
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|youtube\.com|youtu\.be|t\.co|twitter\.com|x\.com|linkedin\.com|lnkd\.in|pinterest\.[a-z.]+|reddit\.com)$/.test(from)) return 'social';
  return 'other';
}

/** What the website sent, as a hit to count, or null if it is not one. Where it came from is kept
 *  for page views only; for a tap it is the page that matters. */
export function siteHitFromBody(value: unknown, siteHost?: string): SiteHit | null {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const kind = SITE_KINDS.find((entry) => entry === body.kind);
  const path = normalizePath(body.path);
  if (!kind || !path) return null;
  return { path, kind, source: kind === 'view' ? sourceOf(body.ref, siteHost) : '' };
}

/** Today's date in India, "2026-11-21", so a day's counts run midnight to midnight there. */
export function indiaDay(now: number = Date.now()): string {
  return new Date(now + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 10);
}

/** The first India day of a period of `days` days ending today. */
export function periodStart(days: number, now: number = Date.now()): string {
  return indiaDay(now - (Math.max(1, Math.floor(days)) - 1) * 24 * 60 * 60 * 1000);
}

/* ---------------------------------------------------------------------------------------------
 * Summing the counts for the screen
 * ------------------------------------------------------------------------------------------- */

export type VisitRow = { day: string; path: string; kind: string; source: string; count: number };
export type Counts = Record<SiteKind, number>;
export type PageLine = { path: string; title: string; counts: Counts };
export type VisitSummary = {
  totals: Counts;
  days: Array<{ day: string; views: number }>;
  posts: PageLine[];
  products: PageLine[];
  pages: PageLine[];
  sources: Array<{ source: SiteSource; label: string; views: number }>;
};

const zero = (): Counts => ({ view: 0, whatsapp: 0, call: 0, share: 0 });

const PAGE_NAMES: Record<string, string> = {
  '/': 'Home page',
  '/catalog': 'Product catalogue',
  '/blogs': 'Blogs (list of articles)',
  '/visit-store': 'Visit the store',
  '/parts-guidance': 'Parts guidance',
};

const titleCase = (slug: string): string => slug.replace(/[-_]+/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());

/**
 * The counts for a period, summed for the Website visits screen: totals, views per day (every day
 * of the period, zero where nothing was counted), and each blog post, product and other page with
 * its own counts, most viewed first, named from the ERP where it can be.
 */
export function summarizeVisits(
  rows: readonly VisitRow[],
  { from, to, postTitles, productTitles }: { from: string; to: string; postTitles: ReadonlyMap<string, string>; productTitles: ReadonlyMap<string, string> }
): VisitSummary {
  const totals = zero();
  const perDay = new Map<string, number>();
  const perPage = new Map<string, Counts>();
  const perSource = new Map<SiteSource, number>();
  for (const row of rows) {
    const kind = SITE_KINDS.find((entry) => entry === row.kind);
    const count = Number(row.count) || 0;
    if (!kind || count <= 0 || row.day < from || row.day > to) continue;
    totals[kind] += count;
    const page = perPage.get(row.path) ?? zero();
    page[kind] += count;
    perPage.set(row.path, page);
    if (kind === 'view') {
      perDay.set(row.day, (perDay.get(row.day) ?? 0) + count);
      const source = SITE_SOURCES.find((entry) => entry === row.source) ?? 'other';
      perSource.set(source, (perSource.get(source) ?? 0) + count);
    }
  }

  const days: VisitSummary['days'] = [];
  for (let day = from; day <= to; day = nextDay(day)) days.push({ day, views: perDay.get(day) ?? 0 });

  const posts: PageLine[] = [];
  const products: PageLine[] = [];
  const pages: PageLine[] = [];
  for (const [path, counts] of perPage) {
    const post = path.match(/^\/blog\/([a-z0-9-]+)$/);
    const product = path.match(/^\/products\/([^/]+)/);
    if (post) posts.push({ path, title: postTitles.get(post[1]) ?? titleCase(post[1]), counts });
    else if (product) products.push({ path, title: productTitles.get(product[1]) ?? 'A part no longer in the catalogue', counts });
    else pages.push({ path, title: PAGE_NAMES[path] ?? titleCase(path.slice(1)), counts });
  }
  const byInterest = (a: PageLine, b: PageLine) =>
    b.counts.view - a.counts.view || (b.counts.whatsapp + b.counts.call) - (a.counts.whatsapp + a.counts.call) || a.title.localeCompare(b.title);

  return {
    totals,
    days,
    posts: posts.sort(byInterest),
    products: products.sort(byInterest),
    pages: pages.sort(byInterest),
    sources: SITE_SOURCES
      .filter((source) => (perSource.get(source) ?? 0) > 0)
      .map((source) => ({ source, label: SOURCE_LABELS[source], views: perSource.get(source) ?? 0 }))
      .sort((a, b) => b.views - a.views),
  };
}

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
