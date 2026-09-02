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
  return `Create a clean commercial catalogue image using the exact product shown in the supplied reference photo.

Product name: ${fallback(fields.name)}
Part number: ${fallback(fields.part_number)}
OEM number: ${fallback(fields.oem_number)}
Brand: ${fallback(fields.brand)}
Category: ${fallback(fields.category)}
Compatible machines: ${fallback(fields.compatibility)}

REFERENCE LOCK: Preserve the product's exact shape, proportions, colour, material, openings, fittings, fasteners, labels, logos, printed text, packaging and included components from the supplied product photo. Do not redesign, simplify, replace or invent any part of the product.
Remove only the product photo's original surroundings. Create a fresh variation of the Jai Durga catalogue setting for this generation: a bright, clean professional service workshop with a softly blurred neutral-grey background and an uncluttered brushed-metal workbench. Vary the workshop layout, cabinet placement and subtle background details on every generation while keeping this same visual family. Place the unchanged product naturally on the workbench with a soft contact shadow.
Do not add people, vehicles, tools, boxes, text, labels, logos, props or extra components that are not already part of the product in the reference photo.
Use a centred, high-resolution 16:9 landscape product-photo composition. Keep the complete product visible with even margins on every side. Use soft diffused daylight, neutral white balance and realistic industrial materials while keeping the product itself unchanged. The new background must not duplicate an earlier composition.`;
}
