import { GoogleGenAI } from '@google/genai';
import { friendlyAiErrorMessage } from '@/lib/ai/friendly-error';

export const dynamic = 'force-dynamic';

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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'GEMINI_API_KEY is not configured. Add it to .env.local and restart the dev server.' },
      { status: 501 }
    );
  }

  const { name, part_number, oem_number, brand, category, compatibility, description } = await request.json();
  if (typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const contents = [
      `Product name: ${name}`,
      part_number ? `Part number: ${part_number}` : null,
      oem_number ? `OEM number: ${oem_number}` : null,
      brand ? `Brand: ${brand}` : null,
      category ? `Category: ${category}` : null,
      compatibility ? `Compatibility (approved, do not expand): ${compatibility}` : null,
      description ? `Admin's existing notes/description (approved, mine this for real details): ${description}` : null,
    ].filter(Boolean).join('\n');

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseJsonSchema: DESCRIPTION_JSON_SCHEMA,
      },
    });

    if (response.promptFeedback?.blockReason) {
      return Response.json({ error: `Gemini declined to draft a description (${response.promptFeedback.blockReason}).` }, { status: 502 });
    }

    const text = response.text;
    if (!text) {
      return Response.json({ error: 'AI provider returned an empty response.' }, { status: 502 });
    }

    return Response.json(JSON.parse(text));
  } catch (error) {
    console.error('ai-catalog-description route failed:', error);
    const message = friendlyAiErrorMessage(error, 'Unknown error drafting description.');
    return Response.json({ error: message }, { status: 500 });
  }
}
