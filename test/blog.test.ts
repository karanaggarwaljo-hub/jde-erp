/**
 * The blog's own rules, away from the screen: the topic bank, web addresses, what is kept of the
 * AI's answer, and how the article text is read. The last one matters most, because the article
 * is shown to the public and must never be able to carry markup of its own.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BlogBody from '../components/blog/BlogBody';
import BlogPhotoPrompts from '../components/blog/BlogPhotoPrompts';
import {
  MACHINES,
  PHOTO_PROMPT_RULES,
  bodyToHtml,
  cleanImagePrompts,
  imagePromptsText,
  TOPICS,
  cleanDraft,
  isValidSlug,
  lengthWords,
  parseBody,
  parseInline,
  publishProblems,
  readMinutes,
  saveProblems,
  slugify,
  splitTags,
  topicCoverage,
  topicsFor,
  uniqueSlug,
  wordCount,
} from '../lib/blog';

test('every topic belongs to a machine on offer and has its own id', () => {
  const ids = TOPICS.map((topic) => topic.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const topic of TOPICS) assert.ok(MACHINES.some((machine) => machine.id === topic.machine), topic.id);
  // Each machine has a real list to work through.
  for (const machine of MACHINES) assert.ok(TOPICS.filter((topic) => topic.machine === machine.id).length >= 6, machine.id);
});

test('no topic asks for a figure the AI could only invent', () => {
  for (const topic of TOPICS) {
    assert.doesNotMatch(topic.title, /\d+\s*(bar|psi|nm|hours?|hrs|rpm|litres?|kg)\b/i, topic.title);
  }
});

test('topics not yet written come first, and coverage counts what has a post', () => {
  const written = new Set(['rb-how-it-works', 'rb-greasing', 'not-a-topic']);
  const breaker = topicsFor('breaker', written);
  assert.equal(breaker.every((topic) => topic.machine === 'breaker'), true);
  const firstWritten = breaker.findIndex((topic) => topic.written);
  assert.ok(firstWritten > 0);
  assert.equal(breaker.slice(firstWritten).every((topic) => topic.written), true);
  assert.deepEqual(topicCoverage(written), { written: 2, total: TOPICS.length });
});

test('a web address is small words joined by hyphens', () => {
  assert.equal(slugify('Rock Breaker Chisel: Moil vs Blunt?'), 'rock-breaker-chisel-moil-vs-blunt');
  assert.equal(slugify('  JCB 3DX — Daily Checks & Greasing  '), 'jcb-3dx-daily-checks-and-greasing');
  assert.equal(slugify('Café pièces'), 'cafe-pieces');
  assert.equal(slugify('!!!'), 'post');
  assert.ok(isValidSlug(slugify('A '.repeat(200))));
  assert.ok(slugify('word '.repeat(60)).length <= 60);
  assert.equal(slugify('Why rock breaker chisels break, and how to make them last longer: a practical guide'), 'why-rock-breaker-chisels-break-and-how-to-make-them-last');
});

test('a web address already used gets -2, -3 and stays valid', () => {
  assert.equal(uniqueSlug('Greasing a breaker', []), 'greasing-a-breaker');
  assert.equal(uniqueSlug('Greasing a breaker', ['greasing-a-breaker']), 'greasing-a-breaker-2');
  assert.equal(uniqueSlug('Greasing a breaker', ['greasing-a-breaker', 'greasing-a-breaker-2']), 'greasing-a-breaker-3');
  const long = 'x'.repeat(60);
  const next = uniqueSlug(long, [long]);
  assert.ok(isValidSlug(next) && next.endsWith('-2'));
});

test('what the AI sends back is trimmed, capped and never missing a field', () => {
  const draft = cleanDraft({
    title: '  How a  rock breaker works  ',
    summary: 'A plain guide.',
    body: '# How a rock breaker works\n\n\n\nIntro line.\r\n\r\n## Parts\n- Chisel',
    faq: [{ question: 'Is it hard?', answer: 'No.' }, { question: 'Missing answer' }, 'junk'],
    tags: ['Rock Breaker', 'rock breaker', '', 7, 'JCB'],
    fact_checks: ['Check the nitrogen figure', ''],
  });
  assert.equal(draft.title, 'How a rock breaker works');
  // The repeated title heading is dropped, and runs of blank lines collapse.
  assert.equal(draft.body, 'Intro line.\n\n## Parts\n- Chisel');
  assert.deepEqual(draft.faq, [{ question: 'Is it hard?', answer: 'No.' }]);
  assert.deepEqual(draft.tags, ['rock breaker', 'jcb']);
  assert.deepEqual(draft.fact_checks, ['Check the nitrogen figure']);

  assert.deepEqual(cleanDraft(null), { title: '', summary: '', body: '', faq: [], tags: [], fact_checks: [], image_prompts: [] });
  assert.equal(cleanDraft({ title: 'x'.repeat(500) }).title.length, 110);
});

test('inline bold and italic are read, and an unclosed marker stays as it is', () => {
  assert.deepEqual(parseInline('Check **every** pin, *daily*.'), [
    { text: 'Check ' }, { text: 'every', bold: true }, { text: ' pin, ' }, { text: 'daily', italic: true }, { text: '.' },
  ]);
  assert.deepEqual(parseInline('2 * 3 is six'), [{ text: '2 * 3 is six' }]);
  assert.deepEqual(parseInline('**not closed'), [{ text: '**not closed' }]);
});

test('the article is read into headings, paragraphs, lists and notes', () => {
  const blocks = parseBody([
    'A breaker needs care.',
    'It works hard every day.',
    '',
    '# Single hash',
    '## Daily checks',
    '- Grease the chisel',
    '  before every shift',
    '- Look at the bush',
    '1. Lower the boom',
    '2) Switch off',
    '> **Safety:** relieve the pressure first.',
    '### Weekly',
    'Last line.',
  ].join('\n'));
  assert.deepEqual(blocks.map((block) => block.kind), ['p', 'h2', 'h2', 'ul', 'ol', 'note', 'h3', 'p']);
  assert.deepEqual(blocks[0], { kind: 'p', text: [{ text: 'A breaker needs care. It works hard every day.' }] });
  const bullets = blocks[3] as { items: Array<Array<{ text: string }>> };
  assert.equal(bullets.items.length, 2);
  assert.equal(bullets.items[0].map((part) => part.text).join(''), 'Grease the chisel before every shift');
});

test('nothing in the article can become markup on the page', () => {
  const hostile = [
    '## <img src=x onerror=alert(1)>',
    '<script>alert("x")</script>',
    '- <a href="javascript:alert(1)">click</a>',
    '> <iframe src="https://example.com"></iframe>',
    '**<b>bold</b>**',
  ].join('\n');
  const html = renderToStaticMarkup(createElement(BlogBody, { body: hostile }));
  assert.doesNotMatch(html, /<script|<img|<iframe|<a /i);
  assert.match(html, /&lt;script&gt;/);
  // Only the elements the reader draws itself.
  const tags = new Set((html.match(/<([a-z0-9]+)/g) ?? []).map((tag) => tag.slice(1)));
  for (const tag of tags) assert.ok(['h2', 'h3', 'p', 'ul', 'ol', 'li', 'aside', 'strong', 'em', 'div'].includes(tag), tag);
});

test('words, reading time and tags', () => {
  const body = `## Heading\n${'word '.repeat(400)}\n- one two`;
  assert.equal(wordCount(body), 403);
  assert.equal(readMinutes(body), 2);
  assert.equal(readMinutes('short'), 1);
  assert.deepEqual(splitTags('JCB, 3DX ,, jcb, rock  breaker'), ['jcb', '3dx', 'rock breaker']);
  assert.equal(lengthWords('long'), 1500);
  assert.equal(lengthWords('nonsense'), 1000);
});

test('a post cannot be published without a title, a summary, a real article and its own address', () => {
  const good = { title: 'Greasing a breaker', slug: 'greasing-a-breaker', summary: 'How and why.', body: 'word '.repeat(200) };
  assert.deepEqual(publishProblems(good, ['something-else']), []);
  assert.equal(publishProblems({ ...good, title: ' ' }, []).length, 1);
  assert.match(publishProblems({ ...good, slug: 'Bad Slug' }, []).join(' '), /small letters/);
  assert.match(publishProblems(good, ['greasing-a-breaker']).join(' '), /already uses/);
  assert.match(publishProblems({ ...good, body: 'too short' }, []).join(' '), /very short/);
  assert.match(publishProblems({ ...good, summary: '' }, []).join(' '), /summary/);
});

test('a draft only needs a title and its own address to be saved', () => {
  assert.deepEqual(saveProblems({ title: 'Half written', slug: 'half-written' }, []), []);
  assert.equal(saveProblems({ title: '', slug: 'half-written' }, []).length, 1);
  assert.equal(saveProblems({ title: 'Half written', slug: 'taken' }, ['taken']).length, 1);
});

test('the website feed gets the same HTML the ERP pages draw, every word escaped', () => {
  const body = '## Daily <checks>\nGrease **every** pin & *bush*.\n\n- one\n- two\n1. first\n> **Safety:** "stop" first';
  const fromReact = renderToStaticMarkup(createElement(BlogBody, { body }));
  // React writes ' as &#x27; and does not escape " in text; compare after evening those out.
  const tidy = (html: string) => html.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
  assert.equal(tidy(bodyToHtml(body)), tidy(fromReact));
  const hostile = bodyToHtml('<script>alert(1)</script>\n- <img src=x onerror=alert(1)>');
  assert.doesNotMatch(hostile, /<script|<img/);
  assert.match(hostile, /&lt;script&gt;/);
});

test('photo prompts are kept tidy, and every one forbids logos and writing whatever the AI said', () => {
  const prompts = cleanImagePrompts([
    { place: 'Cover photo', prompt: '  A realistic photograph of a yellow backhoe loader with a rock breaker at a quarry.  ', alt: 'Backhoe loader breaking rock at a quarry' },
    { place: '', prompt: 'Close-up of a worn breaker chisel next to a new one on a workshop bench, 4:3 format.', alt: '' },
    { place: 'After the section: Greasing', prompt: 'Grease gun on the breaker. No logos, no brand names and no writing.', alt: 'Greasing a breaker' },
    { place: 'Empty', prompt: '   ', alt: 'x' },
    'junk',
  ]);
  assert.equal(prompts.length, 3);
  assert.equal(prompts[0].prompt, `A realistic photograph of a yellow backhoe loader with a rock breaker at a quarry. ${PHOTO_PROMPT_RULES}`);
  // A missing place gets a plain one; the trailing full stop is not doubled.
  assert.equal(prompts[1].place, 'Photo 2');
  assert.ok(prompts[1].prompt.endsWith(`4:3 format. ${PHOTO_PROMPT_RULES}`));
  // One that already says it is not told twice.
  assert.equal(prompts[2].prompt.match(/no logos/gi)?.length, 1);
  for (const item of prompts) assert.match(item.prompt, /no logos/i);

  assert.equal(cleanImagePrompts(Array.from({ length: 9 }, () => ({ prompt: 'p' }))).length, 5);
  assert.deepEqual(cleanImagePrompts(undefined), []);
  assert.equal(cleanDraft({ image_prompts: [{ prompt: 'A photo' }] }).image_prompts[0].place, 'Cover photo');
});

test('all photo prompts copy as one numbered block', () => {
  const block = imagePromptsText([
    { place: 'Cover photo', prompt: 'First.', alt: 'Alt one' },
    { place: 'After the section: Bushes', prompt: 'Second.', alt: '' },
  ]);
  assert.equal(block, '1. Cover photo\nFirst.\nAlt text: Alt one\n\n2. After the section: Bushes\nSecond.');
});

test('the photos box shows each prompt with where it goes and a copy button, and offers to make them when there are none', () => {
  const props = { companyId: 'c1', article: { title: 'T', body: 'B', machine: 'breaker' }, disabled: false, onReplace: async () => {} };
  const markup = renderToStaticMarkup(createElement(BlogPhotoPrompts, {
    ...props,
    prompts: [
      { place: 'Cover photo', prompt: 'A yellow backhoe loader at a quarry. No logos.', alt: 'Backhoe at a quarry' },
      { place: 'After the section: Bushes', prompt: 'A worn bush on a bench. No logos.', alt: '' },
    ],
  }));
  assert.match(markup, /Photos for this post/);
  assert.match(markup, /Cover photo/);
  assert.match(markup, /A yellow backhoe loader at a quarry/);
  assert.equal((markup.match(/Copy prompt/g) ?? []).length, 2);
  assert.match(markup, /Copy all/);
  assert.match(markup, /Alt text: Backhoe at a quarry/);
  assert.match(markup, /Make new photo prompts/);

  const empty = renderToStaticMarkup(createElement(BlogPhotoPrompts, { ...props, prompts: [] }));
  assert.match(empty, /No photo prompts yet/);
  assert.match(empty, /Make photo prompts<\/button>/);
  assert.doesNotMatch(empty, /Copy all/);
});
