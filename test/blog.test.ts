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
  COVER_PLACE,
  END_PLACE,
  MACHINES,
  PHOTO_PROMPT_RULES,
  cleanPhotoSlots,
  isSafePhotoUrl,
  mergePromptsKeepingPhotos,
  photoPlaces,
  placePhotos,
  publicPhotos,
  sectionPlace,
  bodyToHtml,
  cleanImagePrompts,
  imagePromptsText,
  SHORT_DRAFT_SHARE,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  TOPICS,
  cleanDraft,
  plainText,
  isShortDraft,
  postUrl,
  postState,
  indiaLocalToIso,
  isoToIndiaLocal,
  defaultScheduleLocal,
  scheduleProblem,
  indiaWhen,
  whatsappShareUrl,
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

test('a checklist and a table are read as their own blocks', () => {
  const blocks = parseBody([
    'Before you start:',
    '- [ ] Boom lowered to the ground',
    '- [x] Engine **off**',
    '- [] Key out',
    '- plain bullet',
    '',
    '| Symptom | Likely cause | What to do |',
    '| --- | :---: | --- |',
    '| Boom drifts down | Worn cylinder seals | Have the seals *checked* |',
    '| Slow lift | Low oil |',
    '| a | b | c | d | e | f | g |',
    'After the table.',
  ].join('\n'));
  assert.deepEqual(blocks.map((block) => block.kind), ['p', 'checklist', 'ul', 'table', 'p']);
  const checklist = blocks[1] as { items: Array<Array<{ text: string; bold?: boolean }>> };
  assert.deepEqual(checklist.items.map((item) => item.map((part) => part.text).join('')), ['Boom lowered to the ground', 'Engine off', 'Key out']);
  assert.equal(checklist.items[1][1].bold, true);
  const table = blocks[3] as Extract<ReturnType<typeof parseBody>[number], { kind: 'table' }>;
  const words = (cells: Array<Array<{ text: string }>>) => cells.map((cell) => cell.map((part) => part.text).join(''));
  assert.deepEqual(words(table.head), ['Symptom', 'Likely cause', 'What to do', '', '']);
  assert.equal(table.rows.length, 3, 'the separator line is not a row');
  assert.deepEqual(words(table.rows[1]), ['Slow lift', 'Low oil', '', '', ''], 'a short row is padded');
  assert.equal(table.rows[2].length, TABLE_MAX_COLUMNS, 'a wide row is cut to what fits on a phone');
  assert.equal(table.rows[0][2][1].italic, true);

  // Without a separator line there is no heading row; a table is cut to TABLE_MAX_ROWS.
  const plain = parseBody(Array.from({ length: 40 }, (_, n) => `| row ${n} | x |`).join('\n'))[0] as typeof table;
  assert.deepEqual(plain.head, []);
  assert.equal(plain.rows.length, TABLE_MAX_ROWS);
  assert.match(plainText('| Part | Check |\n|---|---|\n| Pin | Play |'), /^Part Check Pin Play$/);
});

test('nothing in the article can become markup on the page', () => {
  const hostile = [
    '## <img src=x onerror=alert(1)>',
    '<script>alert("x")</script>',
    '- <a href="javascript:alert(1)">click</a>',
    '> <iframe src="https://example.com"></iframe>',
    '**<b>bold</b>**',
    '| <script>x</script> | <img src=x> |',
    '- [ ] <svg onload=alert(1)>',
  ].join('\n');
  const html = renderToStaticMarkup(createElement(BlogBody, { body: hostile }));
  assert.doesNotMatch(html, /<script|<img|<iframe|<a |<svg/i);
  assert.match(html, /&lt;script&gt;/);
  // Only the elements the reader draws itself.
  const tags = new Set((html.match(/<([a-z0-9]+)/g) ?? []).map((tag) => tag.slice(1)));
  for (const tag of tags) assert.ok(['h2', 'h3', 'p', 'ul', 'ol', 'li', 'aside', 'strong', 'em', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td'].includes(tag), tag);
});

test('a draft well short of the length asked is sent back once to be filled out', () => {
  assert.equal(SHORT_DRAFT_SHARE, 0.7);
  assert.equal(isShortDraft('word '.repeat(550), 1000), true, 'the published post: about 550 words of the 1,000 asked');
  assert.equal(isShortDraft('word '.repeat(700), 1000), false);
  assert.equal(isShortDraft('word '.repeat(450), 600), false, 'a short post asked to be short is fine');
});

test('a post published with a later time is scheduled, and becomes live by itself when the time comes', () => {
  const now = Date.parse('2026-11-21T06:00:00Z');
  assert.equal(postState({ status: 'draft', published_at: null }, now), 'draft');
  assert.equal(postState({ status: 'draft', published_at: '2026-12-01T03:30:00Z' }, now), 'draft');
  assert.equal(postState({ status: 'published', published_at: '2026-11-20T10:00:00Z' }, now), 'live');
  assert.equal(postState({ status: 'published', published_at: null }, now), 'live', 'just published, before the database stamps the time');
  assert.equal(postState({ status: 'published', published_at: '2026-11-24T03:30:00Z' }, now), 'scheduled');
  assert.equal(postState({ status: 'published', published_at: '2026-11-24T03:30:00Z' }, Date.parse('2026-11-24T03:30:01Z')), 'live');
});

test('go-live times are chosen and shown in India time', () => {
  // 9:00 in the morning in India is 3:30 UTC; India has no daylight saving, so in June too.
  assert.equal(indiaLocalToIso('2026-11-24T09:00'), '2026-11-24T03:30:00.000Z');
  assert.equal(indiaLocalToIso('2026-06-24T09:00'), '2026-06-24T03:30:00.000Z');
  assert.equal(indiaLocalToIso('2026-11-24T00:15'), '2026-11-23T18:45:00.000Z', 'just after midnight in India is the evening before in UTC');
  assert.equal(isoToIndiaLocal('2026-11-23T18:45:00.000Z'), '2026-11-24T00:15');
  assert.equal(indiaLocalToIso('2026-02-30T09:00'), '', 'no 30th of February');
  assert.equal(indiaLocalToIso('tomorrow'), '');
  assert.equal(defaultScheduleLocal(Date.parse('2026-11-21T20:00:00Z')), '2026-11-23T09:00', 'at 1:30 am on the 22nd in India, tomorrow is the 23rd');
  assert.equal(defaultScheduleLocal(Date.parse('2026-11-21T06:00:00Z')), '2026-11-22T09:00');
  assert.match(indiaWhen('2026-11-24T03:30:00Z'), /^24 Nov,? 9:00\s?am$/i);
  assert.equal(indiaWhen(null), '');
});

test('a go-live time must be a little ahead and within a year', () => {
  const now = Date.parse('2026-11-21T06:00:00Z');
  assert.equal(scheduleProblem('2026-11-22T03:30:00.000Z', now), '');
  assert.match(scheduleProblem('', now), /Choose the date and time/);
  assert.match(scheduleProblem('2026-11-21T06:02:00.000Z', now), /few minutes from now/);
  assert.match(scheduleProblem('2026-11-20T06:00:00.000Z', now), /few minutes from now/, 'a time already passed');
  assert.match(scheduleProblem('2028-01-01T00:00:00.000Z', now), /within the next year/);
});

test('a published post is shared on WhatsApp with its title, summary and website address', () => {
  assert.equal(postUrl('jd-enterprise.com', 'greasing-a-breaker'), 'https://jd-enterprise.com/blog/greasing-a-breaker');
  const url = whatsappShareUrl({ title: ' Greasing a breaker ', summary: 'How & why.', slug: 'greasing-a-breaker' }, 'jd-enterprise.com');
  assert.match(url, /^https:\/\/wa\.me\/\?text=/);
  assert.equal(decodeURIComponent(url.slice('https://wa.me/?text='.length)), 'Greasing a breaker\n\nHow & why.\n\nhttps://jd-enterprise.com/blog/greasing-a-breaker');
  assert.equal(decodeURIComponent(whatsappShareUrl({ title: 'T', summary: null, slug: 's' }, 'x.test').split('text=')[1]), 'T\n\nhttps://x.test/blog/s');
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
  const body = '## Daily <checks>\nGrease **every** pin & *bush*.\n\n- one\n- two\n1. first\n> **Safety:** "stop" first\n\n- [ ] Boom **down**\n- [ ] Key out\n\n| Part | What to look for |\n|---|---|\n| Pin | Play & *scoring* |\n\n| no | heading |';
  const fromReact = renderToStaticMarkup(createElement(BlogBody, { body }));
  // React writes ' as &#x27; and does not escape " in text; compare after evening those out.
  const tidy = (html: string) => html.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
  assert.equal(tidy(bodyToHtml(body)), tidy(fromReact));
  assert.match(bodyToHtml(body), /<ul class="blog-checklist"><li>Boom <strong>down<\/strong><\/li><li>Key out<\/li><\/ul>/);
  assert.match(bodyToHtml(body), /<div class="blog-table"><table><thead><tr><th>Part<\/th><th>What to look for<\/th><\/tr><\/thead><tbody><tr><td>Pin<\/td><td>Play &amp; <em>scoring<\/em><\/td><\/tr><\/tbody><\/table><\/div>/);
  assert.match(bodyToHtml(body), /<div class="blog-table"><table><tbody><tr><td>no<\/td><td>heading<\/td><\/tr><\/tbody><\/table><\/div>/);
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

test('the photos box shows each slot with where it goes, its prompt or photo, and an upload button', () => {
  const props = { postId: 'p1', companyId: 'c1', article: { title: 'T', body: '## Bushes\nText.', machine: 'breaker' }, disabled: false, onReplace: async () => {} };
  const markup = renderToStaticMarkup(createElement(BlogPhotoPrompts, {
    ...props,
    prompts: [
      { place: 'Cover photo', prompt: 'A yellow backhoe loader at a quarry. No logos.', alt: 'Backhoe at a quarry', url: PHOTO },
      { place: 'After the section: Bushes', prompt: 'A worn bush on a bench. No logos.', alt: '' },
      { place: 'After the section: Gone', prompt: '', alt: 'Own photo', url: PHOTO },
    ],
  }));
  assert.match(markup, /Photos for this post/);
  // An uploaded photo is shown, with Replace and Remove; a slot without one offers Upload.
  assert.match(markup, /class="blog-photo-thumb" src="https:\/\/abc\.supabase\.co/);
  assert.equal((markup.match(/Replace photo/g) ?? []).length, 2);
  assert.equal((markup.match(/>Upload photo</g) ?? []).length + (markup.match(/Upload photo<\/button>/g) ?? []).length > 0, true);
  // The prompt of a slot without a photo is shown; copy buttons only where there is a prompt.
  assert.match(markup, /A worn bush on a bench/);
  assert.equal((markup.match(/Copy prompt/g) ?? []).length, 2);
  // Where it goes: the article's own sections, and a place whose section was deleted says so.
  assert.match(markup, /<option value="After the section: Bushes" selected="">/);
  assert.match(markup, /section not found: goes at the end/);
  assert.match(markup, /Add your own photo/);
  assert.match(markup, /Make new photo prompts/);
  // A prompt without a photo can be made here; one with a photo can be made again. Only one photo is
  // missing, so there is no "Make all" button.
  assert.equal((markup.match(/Generate photo<\/button>/g) ?? []).length, 1);
  assert.equal((markup.match(/Generate again<\/button>/g) ?? []).length, 1, 'not for the owner\'s own photo, which has no prompt');
  assert.doesNotMatch(markup, /Make all/);

  const twoMissing = renderToStaticMarkup(createElement(BlogPhotoPrompts, {
    ...props,
    prompts: [
      { place: 'Cover photo', prompt: 'A yellow backhoe loader at a quarry. No logos.', alt: '' },
      { place: 'After the section: Bushes', prompt: 'A worn bush on a bench. No logos.', alt: '' },
    ],
  }));
  assert.match(twoMissing, /Make all 2 photos<\/button>/);

  const empty = renderToStaticMarkup(createElement(BlogPhotoPrompts, { ...props, prompts: [] }));
  assert.match(empty, /No photos yet/);
  assert.match(empty, /Make photo prompts<\/button>/);
  assert.doesNotMatch(empty, /Copy all/);
});

const PHOTO = 'https://abc.supabase.co/storage/v1/object/public/jde-catalog-images/blog-photos/c1/p1-1.jpg';

test('only an ordinary https address can be a photo', () => {
  assert.equal(isSafePhotoUrl(PHOTO), true);
  for (const bad of ['javascript:alert(1)', 'http://plain.example.com/a.jpg', 'data:image/png;base64,AAAA', 'https://x.com/a.jpg" onerror="alert(1)', 'https://x.com/a b.jpg', '', 42, null]) {
    assert.equal(isSafePhotoUrl(bad), false, String(bad));
  }
});

test('photo slots keep a prompt or an uploaded photo, drop unsafe addresses, and are capped', () => {
  const slots = cleanPhotoSlots([
    { place: 'Cover photo', prompt: 'A prompt', alt: 'Cover', url: PHOTO },
    { place: '', prompt: '', alt: 'Own photo', url: PHOTO },
    { place: 'After the section: Bushes', prompt: 'Another', alt: '', url: 'javascript:alert(1)' },
    { place: 'Nothing', prompt: '', alt: 'x' },
  ]);
  assert.equal(slots.length, 3);
  assert.equal(slots[1].place, END_PLACE);
  assert.equal(slots[2].url, undefined);
  assert.equal(cleanPhotoSlots(Array.from({ length: 20 }, () => ({ prompt: 'p' }))).length, 8);
});

test('new prompts never wipe out a photo already uploaded', () => {
  const current = [
    { place: COVER_PLACE, prompt: 'old cover', alt: 'c', url: PHOTO },
    { place: 'After the section: Bushes', prompt: 'old bush', alt: 'b' },
    { place: END_PLACE, prompt: '', alt: 'own', url: PHOTO },
  ];
  const fresh = [
    { place: 'Cover photo', prompt: 'new cover', alt: '' },
    { place: 'After the section: Bushes', prompt: 'new bush', alt: '' },
    { place: 'After the section: Chisels', prompt: 'new chisel', alt: '' },
  ];
  const merged = mergePromptsKeepingPhotos(current, fresh);
  assert.deepEqual(merged.map((slot) => slot.prompt), ['old cover', '', 'new bush', 'new chisel']);
  assert.ok(merged.filter((slot) => slot.url).length === 2);
});

test('the public sees uploaded photos only, and never a prompt', () => {
  const { cover, photos } = publicPhotos([
    { place: 'Cover photo', prompt: 'SECRET PROMPT', alt: 'Cover alt', url: PHOTO },
    { place: 'After the section: Bushes', prompt: 'SECRET TOO', alt: 'Bush', url: PHOTO },
    { place: 'After the section: Chisels', prompt: 'no photo yet', alt: 'Chisel' },
  ]);
  assert.deepEqual(cover, { place: 'Cover photo', url: PHOTO, alt: 'Cover alt' });
  assert.deepEqual(photos, [{ place: 'After the section: Bushes', url: PHOTO, alt: 'Bush' }]);
  assert.doesNotMatch(JSON.stringify({ cover, photos }), /SECRET|prompt/i);
  assert.deepEqual(publicPhotos(null), { cover: null, photos: [] });
});

const ARTICLE = ['Intro.', '', '## Daily checks', 'Look at it.', '### Grease', 'Grease it.', '', '## When to call a mechanic', 'Call one.'].join('\n');

test('the places offered are the cover, every section, and the end', () => {
  assert.deepEqual(photoPlaces(ARTICLE), [COVER_PLACE, sectionPlace('Daily checks'), sectionPlace('Grease'), sectionPlace('When to call a mechanic'), END_PLACE]);
});

test('each photo lands after its own section, a lost section sends it to the end, and the cover stays out', () => {
  const placed = placePhotos(parseBody(ARTICLE), [
    { place: 'Cover photo', url: PHOTO, alt: 'cover' },
    { place: 'After the section: daily CHECKS!', url: PHOTO, alt: 'daily' },
    { place: 'After the section: Grease', url: PHOTO, alt: 'grease' },
    { place: 'After the section: A heading that was deleted', url: PHOTO, alt: 'lost' },
    { place: END_PLACE, url: PHOTO, alt: 'end' },
    { place: 'After the section: When to call a mechanic', url: 'javascript:alert(1)', alt: 'unsafe' },
  ]);
  const order = placed.map((block) => (block.kind === 'photo' ? `photo:${block.alt}` : block.kind));
  // "Daily checks" is an h2: its section runs past its own h3 to the next h2, so both photos meet
  // there, in the order of the photo list.
  assert.deepEqual(order, ['p', 'h2', 'p', 'h3', 'p', 'photo:daily', 'photo:grease', 'h2', 'p', 'photo:lost', 'photo:end']);
});

test('the website feed draws placed photos the same way the ERP pages do, with the address escaped', () => {
  const photos = [{ place: 'After the section: Daily checks', url: PHOTO, alt: 'A "worn" chisel & bush' }];
  const fromReact = renderToStaticMarkup(createElement(BlogBody, { body: ARTICLE, photos }));
  const tidy = (html: string) => html.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
  assert.equal(tidy(bodyToHtml(ARTICLE, photos)), tidy(fromReact));
  assert.match(bodyToHtml(ARTICLE, photos), /<figure class="blog-photo"><img src="https:\/\/abc\.supabase\.co[^"]+" alt="A &quot;worn&quot; chisel &amp; bush" loading="lazy"\/><\/figure>/);
});
