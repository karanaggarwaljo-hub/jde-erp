/**
 * Website visits (lib/site-visits.ts): what the website may count, where a visitor came from, and
 * how the counts are summed for the Website visits screen.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { indiaDay, normalizePath, periodStart, siteHitFromBody, sourceOf, summarizeVisits, type VisitRow } from '../lib/site-visits';

test('only an address the website could have is counted, tidied to one form', () => {
  assert.equal(normalizePath('/'), '/');
  assert.equal(normalizePath('/blog/greasing-a-breaker/'), '/blog/greasing-a-breaker');
  assert.equal(normalizePath('/Catalog?category=Filters#top'), '/catalog');
  assert.equal(normalizePath('/products/2157349b-d0bd/jcb-hydraulic-pump'), '/products/2157349b-d0bd/jcb-hydraulic-pump');
  for (const bad of ['', 'blog', '/blog/<script>', '/a b', '//evil.example', '/../etc/passwd', '/api/visit', '/x'.repeat(100), 42, null]) {
    assert.equal(normalizePath(bad), '', String(bad));
  }
});

test('where a visitor came from, in plain groups', () => {
  assert.equal(sourceOf(''), 'direct');
  assert.equal(sourceOf(undefined), 'direct');
  assert.equal(sourceOf('not a url'), 'direct');
  assert.equal(sourceOf('https://www.google.com/'), 'google');
  assert.equal(sourceOf('https://www.google.co.in/search?q=jcb+pin'), 'google');
  assert.equal(sourceOf('https://www.bing.com/search?q=x'), 'search');
  assert.equal(sourceOf('https://l.wl.co/l?u=x'), 'whatsapp');
  assert.equal(sourceOf('https://web.whatsapp.com/'), 'whatsapp');
  assert.equal(sourceOf('https://m.facebook.com/'), 'social');
  assert.equal(sourceOf('https://www.youtube.com/watch?v=1'), 'social');
  assert.equal(sourceOf('https://jd-enterprise.com/blogs'), 'site');
  assert.equal(sourceOf('https://example.org/'), 'other');
  assert.equal(sourceOf('https://notgoogle.example/'), 'other', 'only Google itself counts as Google');
});

test('a hit is a known kind on a real page; where it came from is kept for page views only', () => {
  assert.deepEqual(siteHitFromBody({ kind: 'view', path: '/blog/a-post', ref: 'https://www.google.com/' }), { path: '/blog/a-post', kind: 'view', source: 'google' });
  assert.deepEqual(siteHitFromBody({ kind: 'whatsapp', path: '/blog/a-post', ref: 'https://www.google.com/' }), { path: '/blog/a-post', kind: 'whatsapp', source: '' });
  assert.equal(siteHitFromBody({ kind: 'purchase', path: '/' }), null);
  assert.equal(siteHitFromBody({ kind: 'view', path: 'https://evil.example/' }), null);
  assert.equal(siteHitFromBody('view'), null);
  assert.equal(siteHitFromBody(null), null);
});

test('days run midnight to midnight in India', () => {
  assert.equal(indiaDay(Date.parse('2026-11-21T18:29:00Z')), '2026-11-21');
  assert.equal(indiaDay(Date.parse('2026-11-21T18:31:00Z')), '2026-11-22', '00:01 in India is still the 21st in UTC');
  assert.equal(periodStart(7, Date.parse('2026-11-21T06:00:00Z')), '2026-11-15');
  assert.equal(periodStart(1, Date.parse('2026-11-21T06:00:00Z')), '2026-11-21');
});

test('counts are summed per page, per day and per source, named from the ERP, most visited first', () => {
  const rows: VisitRow[] = [
    { day: '2026-11-19', path: '/blog/pins-and-bushes', kind: 'view', source: 'google', count: 5 },
    { day: '2026-11-20', path: '/blog/pins-and-bushes', kind: 'view', source: 'whatsapp', count: 3 },
    { day: '2026-11-20', path: '/blog/pins-and-bushes', kind: 'whatsapp', source: '', count: 2 },
    { day: '2026-11-20', path: '/blog/pins-and-bushes', kind: 'share', source: '', count: 1 },
    { day: '2026-11-21', path: '/blog/old-post', kind: 'view', source: 'direct', count: 9 },
    { day: '2026-11-21', path: '/products/p1/pin-kit', kind: 'view', source: 'site', count: 4 },
    { day: '2026-11-21', path: '/products/p1/pin-kit', kind: 'call', source: '', count: 1 },
    { day: '2026-11-21', path: '/products/gone/old-part', kind: 'view', source: 'site', count: 1 },
    { day: '2026-11-21', path: '/', kind: 'view', source: 'direct', count: 6 },
    { day: '2026-11-21', path: '/jcb-hydraulic-pump-chandigarh', kind: 'view', source: 'google', count: 2 },
    { day: '2026-11-10', path: '/', kind: 'view', source: 'direct', count: 100 },
    { day: '2026-11-21', path: '/', kind: 'nonsense', source: '', count: 50 },
  ];
  const summary = summarizeVisits(rows, {
    from: '2026-11-18',
    to: '2026-11-21',
    postTitles: new Map([['pins-and-bushes', 'How to spot wear on pins and bushes']]),
    productTitles: new Map([['p1', 'BKT pin bush kit']]),
  });
  assert.deepEqual(summary.totals, { view: 30, whatsapp: 2, call: 1, share: 1 }, 'outside the period and unknown kinds are left out');
  assert.deepEqual(summary.days, [
    { day: '2026-11-18', views: 0 }, { day: '2026-11-19', views: 5 }, { day: '2026-11-20', views: 3 }, { day: '2026-11-21', views: 22 },
  ], 'every day of the period, zero where nothing was counted');
  assert.deepEqual(summary.posts.map((line) => [line.title, line.counts.view, line.counts.whatsapp, line.counts.share]), [
    ['Old post', 9, 0, 0],
    ['How to spot wear on pins and bushes', 8, 2, 1],
  ]);
  assert.deepEqual(summary.products.map((line) => [line.title, line.counts.view, line.counts.call]), [
    ['BKT pin bush kit', 4, 1],
    ['A part no longer in the catalogue', 1, 0],
  ]);
  assert.deepEqual(summary.pages.map((line) => [line.title, line.counts.view]), [
    ['Home page', 6],
    ['Jcb hydraulic pump chandigarh', 2],
  ]);
  assert.deepEqual(summary.sources.map((line) => [line.source, line.views]), [['direct', 15], ['google', 7], ['site', 5], ['whatsapp', 3]]);
});
