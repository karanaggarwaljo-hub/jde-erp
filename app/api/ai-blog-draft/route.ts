import { aiErrorResponse, generateJson } from '@/lib/ai/generate';
import { checkCompanyAccess } from '@/lib/auth/dal';
import { cleanDraft, isMachine, lengthWords, machineLabel, topicById } from '@/lib/blog';
import { DEFAULT_FORMAT, formatById, isFormat } from '@/lib/blog-formats';
import { IMAGE_PROMPTS_SCHEMA, PHOTO_GUIDANCE } from '@/lib/blog-photo-prompts';

export const dynamic = 'force-dynamic';
// A full article takes a provider longer than a one-line answer. The function is allowed to run
// past the per-provider budget below so a fallback can still finish.
export const maxDuration = 90;

const BLOG_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: {
      type: 'string',
      description: 'The article headline. Plain, specific and useful, the way a reader would search for it. Ideally under 60 characters, never over 100. No clickbait, no year, no exclamation marks.',
    },
    summary: {
      type: 'string',
      description: 'One or two sentences, under 160 characters, saying what the reader will learn. Shown by search engines under the title.',
    },
    body: {
      type: 'string',
      description:
        'The article, laid out exactly as the Format in the request says, using ONLY this formatting: "## " for a section heading, "### " for a smaller heading, "- " for a bullet, "1. " for a numbered step, ' +
        '"- [ ] " for an item of a checklist, "> " for a short safety note, tip or fact, **bold** and *italic*. A blank line between paragraphs, lists and tables. ' +
        'A table only where the Format asks for one: a heading row such as "| Symptom | Likely causes | What to check first |", then the line "| --- | --- | --- |", then one row per line, at most 5 columns, a few words per cell. ' +
        'No title heading at the top (the title is shown separately), no links, no images, no HTML.',
    },
    faq: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          question: { type: 'string', description: 'A question a machine owner or operator actually asks about this topic.' },
          answer: { type: 'string', description: 'A direct answer in two to four sentences.' },
        },
        required: ['question', 'answer'],
      },
      description: 'Three to five common questions with short answers, not repeating the article word for word.',
    },
    tags: {
      type: 'array',
      maxItems: 6,
      items: { type: 'string' },
      description: 'Three to six short lower-case tags, such as "backhoe loader", "rock breaker", "maintenance", "hydraulics".',
    },
    fact_checks: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string' },
      description:
        'For the shop owner, NOT published: each statement in the article that should be checked before publishing, because it is specific to particular machine models or you are not fully sure of it. Quote or name the statement and say what to check. Empty only if the article makes no such statement.',
    },
    image_prompts: IMAGE_PROMPTS_SCHEMA,
  },
  required: ['title', 'summary', 'body', 'faq', 'tags', 'fact_checks', 'image_prompts'],
};

const SYSTEM_PROMPT = [
  'You write practical blog articles for the website of an Indian spare parts business that serves owners, operators and mechanics of earthmoving machines:',
  'backhoe loaders (most commonly the JCB 3DX and its variants), hydraulic rock breakers fitted to backhoe loaders and excavators, and crawler excavators.',
  '',
  'Write for a working reader in India: a contractor running two or three machines, an operator, or a site mechanic. Use plain, simple English with short sentences,',
  'the way an experienced mechanic explains things at the counter. Be concrete and practical: what to look at, what it means, what to do, what it costs you if ignored.',
  'Use the Indian working context where it genuinely applies: heat and dust, the monsoon, long rental shifts, quarry and road work, diesel quality, the cost of downtime.',
  '',
  'Accuracy rules, which matter more than anything else:',
  '- Do not state exact figures that depend on the machine model: pressures, torques, flow rates, capacities, clearances, service intervals in hours, nitrogen charge values, part numbers or prices.',
  '  Where a figure matters, tell the reader to take it from the machine or attachment manufacturer\'s manual or service schedule, and list it in fact_checks if you mention any number at all.',
  '- Do not invent standards, certifications, warranty terms, statistics, studies or quotes.',
  '- Never claim the business is an authorised dealer of, or affiliated with, any manufacturer. Brand and model names may be used only to say which machines the advice is about.',
  '- Do not name any shop, company, website, phone number or price, including the business you write for: the website adds its own contact details below the article.',
  '- Include a short safety note wherever the work involves raised booms or attachments, stored hydraulic pressure, nitrogen-charged parts, hot oil or coolant, or working under the machine.',
  '  Jobs that need special equipment or training (such as charging nitrogen or setting relief valves) should be described as jobs for a trained mechanic, without step-by-step instructions.',
  '',
  'If the shop owner gives notes, use them: they are true facts about the business or the topic and take priority over your own general knowledge.',
  '',
  PHOTO_GUIDANCE,
].join('\n');

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * Writes a first draft of one blog article. Nothing is saved here: the Blog screen saves what comes
 * back as a draft, which the owner reads and edits before publishing.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const companyId = text(body?.companyId, 100);
  if (!companyId) return Response.json({ error: 'companyId is required' }, { status: 400 });
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  const machine = isMachine(body?.machine) ? body.machine : 'general';
  const topic = text(body?.topic, 300) || topicById(text(body?.topicId, 80))?.title || '';
  if (!topic) return Response.json({ error: 'Choose a topic or type one.' }, { status: 400 });
  const notes = text(body?.notes, 1500);
  const words = lengthWords(body?.length);
  // The writer sends the format it picked (lib/blog-formats.ts nextFormat) or the owner chose.
  const format = formatById(isFormat(body?.format) ? body.format : DEFAULT_FORMAT);

  const prompt = [
    `Machine: ${machineLabel(machine)}`,
    `Topic: ${topic}`,
    `Format: ${format.label}. ${format.structure}`,
    `Length: about ${words} words in the body.`,
    notes ? `Notes from the shop owner (true, use them): ${notes}` : null,
  ].filter(Boolean).join('\n');

  try {
    const { data, model } = await generateJson<Record<string, unknown>>({
      system: SYSTEM_PROMPT,
      prompt,
      schema: BLOG_JSON_SCHEMA,
      schemaName: 'blog_article',
      timeoutMs: 60_000,
    });
    const draft = cleanDraft(data);
    if (!draft.title || draft.body.length < 200) {
      return Response.json({ error: 'The AI sent back an article that was too short to use. Please press Write the post again.' }, { status: 502 });
    }
    return Response.json({ ...draft, format: format.id, model });
  } catch (error) {
    console.error('ai-blog-draft route failed:', error);
    return aiErrorResponse(error, 'The article could not be written.');
  }
}
