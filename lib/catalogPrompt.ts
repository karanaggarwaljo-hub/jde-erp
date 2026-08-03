/** Fills the PRD's fixed image-prompt template from approved catalog fields. Deliberately plain
 *  string interpolation, not an AI call — the whole point of a "controlled" prompt is that it
 *  can't drift or hallucinate; only the fields the admin has already approved go into it. */
export function buildCatalogImagePrompt(fields: {
  name: string;
  part_number: string;
  oem_number: string;
  brand: string;
  category: string;
  compatibility: string;
}): string {
  const fallback = (value: string) => (value && value.trim() ? value.trim() : 'Not specified');
  return `Create a clean commercial product catalog image of a heavy-machinery spare part.

Product name: ${fallback(fields.name)}
Part number: ${fallback(fields.part_number)}
OEM number: ${fallback(fields.oem_number)}
Brand: ${fallback(fields.brand)}
Category: ${fallback(fields.category)}
Compatible machines: ${fallback(fields.compatibility)}

Show one accurate-looking generic replacement part on a neutral light workshop background.
Do not add logos, labels, part numbers, text, packaging, people, machinery, or extra components unless they are in approved product data.
Use a centered, high-resolution product-photo composition suitable for an industrial spare-parts catalog.`;
}
