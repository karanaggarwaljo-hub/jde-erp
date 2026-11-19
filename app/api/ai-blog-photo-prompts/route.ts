import { aiErrorResponse, generateJson } from '@/lib/ai/generate';
import { checkCompanyAccess } from '@/lib/auth/dal';
import { cleanImagePrompts, isMachine, machineLabel } from '@/lib/blog';
import { IMAGE_PROMPTS_SCHEMA, PHOTO_GUIDANCE } from '@/lib/blog-photo-prompts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { image_prompts: IMAGE_PROMPTS_SCHEMA },
  required: ['image_prompts'],
};

const SYSTEM_PROMPT = [
  'You plan the photos for a practical blog article on the website of an Indian spare parts business serving owners and operators of backhoe loaders, hydraulic rock breakers and crawler excavators.',
  'Read the article given and decide which photos would help a reader most. Base every photo on what the article actually says.',
  PHOTO_GUIDANCE,
].join('\n');

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * Fresh photo prompts for an article as it stands now, for after the owner has edited it, or when
 * he wants different photos. Nothing is saved here: the Blog screen saves what comes back.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const companyId = text(body?.companyId, 100);
  if (!companyId) return Response.json({ error: 'companyId is required' }, { status: 400 });
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  const title = text(body?.title, 150);
  const article = text(body?.body, 30000);
  if (!title || article.length < 100) {
    return Response.json({ error: 'Write the article first. Photo prompts are made from what it says.' }, { status: 400 });
  }
  const machine = isMachine(body?.machine) ? body.machine : 'general';

  try {
    const { data } = await generateJson<Record<string, unknown>>({
      system: SYSTEM_PROMPT,
      prompt: `Machine: ${machineLabel(machine)}\nTitle: ${title}\n\nArticle:\n${article}`,
      schema: SCHEMA,
      schemaName: 'blog_photo_prompts',
      timeoutMs: 40_000,
    });
    const prompts = cleanImagePrompts(data.image_prompts);
    if (prompts.length === 0) {
      return Response.json({ error: 'The AI sent back no photo prompts. Please press the button again.' }, { status: 502 });
    }
    return Response.json({ image_prompts: prompts });
  } catch (error) {
    console.error('ai-blog-photo-prompts route failed:', error);
    return aiErrorResponse(error, 'The photo prompts could not be made.');
  }
}
