import { aiErrorResponse, generateJson } from '@/lib/ai/generate';

export const dynamic = 'force-dynamic';
// The AI layer may legitimately spend ~25s on a slow provider before its own fallback
// resolves; without this the platform could cut the function off first and turn a
// recoverable slow call into an unexplained failure.
export const maxDuration = 60;

const DESCRIPTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', description: 'A clean, customer-facing product title built from the approved name/brand/part number given. No invented model years or claims.' },
    short_description: { type: 'string', description: 'Two to three sentences of natural, specific product copy — like something a knowledgeable parts-counter person would say, not a template like "This is a [name] under [category]". Read the given name/description/compatibility text closely and mention the real specifics actually stated in them (e.g. a service interval, an emission/quality standard, what a "kit" bundles together, a stated material or use-case) — pulling out and explaining details that are already in the given text is not fabrication, only stating something NOT present anywhere in the given fields is. If the given fields truly contain nothing beyond a bare name/category/brand, keep it short and honest rather than padding it.' },
    key_features: { type: 'array', items: { type: 'string' }, description: 'Specific, useful bullet points — each one should tell the buyer something they could not already see from the brand/part number/category shown elsewhere on the page. Draw these out of details actually present in the name, description, or compatibility text (service intervals, standards/certifications named, what a kit contains, application notes). Do NOT create a bullet that merely restates the brand, part number, or category by themselves — that is redundant, not a feature. Return an empty array if nothing beyond bare identification is available, rather than padding it with restated fields.' },
    compatible_machines: { type: 'array', items: { type: 'string' }, description: 'Copied/split from the approved compatibility text given, never expanded or guessed beyond it. Empty array if compatibility was not provided.' },
    search_keywords: { type: 'array', items: { type: 'string' }, description: 'Search terms a buyer might use — part number, OEM number, brand, category, common synonyms. No invented terms unrelated to the given data.' },
    warnings: { type: 'array', items: { type: 'string' }, description: 'Only include a warning if the approved data itself implies one worth surfacing (e.g. compatibility is very narrow). Usually empty.' },
  },
  required: ['title', 'short_description', 'key_features', 'compatible_machines', 'search_keywords', 'warnings'],
};

const SYSTEM_PROMPT =
  'You write website catalog descriptions for an Indian auto/heavy-machinery spare parts trading business, from approved ' +
  'ERP product data only. Write like an experienced parts-counter person, not a form letter — read every given field ' +
  'closely (the product name in particular often already contains real specifics: a service interval, an emission/BS ' +
  'standard, what a "kit" includes, a material, an application) and use those specifics naturally in the copy. Pulling ' +
  'out and explaining a detail that is already present somewhere in the given text is expected and good; the line you must ' +
  'not cross is stating or implying something that is not present or clearly implied anywhere in the given fields — never ' +
  'invent or imply OEM status, fitment guarantees, warranty terms, safety claims, technical specifications, stock levels, ' +
  'discounts, or brand affiliation beyond that. Key features must add real information, not restate the brand/part number/' +
  'category that are already shown separately on the page — if there is truly nothing more to say, say less rather than ' +
  'padding with restated fields. This copy will be shown to real customers, so ground it in truth, but there is no need to ' +
  'sound like a database dump either.';

export async function POST(request: Request) {
  const { name, part_number, oem_number, brand, category, compatibility, description } = await request.json();
  if (typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }

  try {
    const contents = [
      `Product name: ${name}`,
      part_number ? `Part number: ${part_number}` : null,
      oem_number ? `OEM number: ${oem_number}` : null,
      brand ? `Brand: ${brand}` : null,
      category ? `Category: ${category}` : null,
      compatibility ? `Compatibility (approved, do not expand): ${compatibility}` : null,
      description ? `Admin's existing notes/description (approved, mine this for real details): ${description}` : null,
    ].filter(Boolean).join('\n');

    const { data } = await generateJson({
      system: SYSTEM_PROMPT,
      prompt: contents,
      schema: DESCRIPTION_JSON_SCHEMA,
      schemaName: 'catalog_description',
      // Left on the quality path deliberately: this copy is published to real customers, and the
      // hedge already caps how long a slow provider can hold it up.
    });

    return Response.json(data);
  } catch (error) {
    console.error('ai-catalog-description route failed:', error);
    return aiErrorResponse(error, 'Unknown error drafting description.');
  }
}
