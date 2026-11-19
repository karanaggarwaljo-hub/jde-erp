/**
 * What the AI is asked for when it describes the photos a blog post needs. Shared by the route that
 * writes a whole draft (app/api/ai-blog-draft) and the one that makes fresh photo prompts for an
 * article already written (app/api/ai-blog-photo-prompts), so both ask for the same thing.
 *
 * The owner pastes each prompt into an AI image tool (Gemini, ChatGPT, Microsoft Designer) to make
 * the photo. lib/blog.ts cleanImagePrompts then adds the no-logo rule to every prompt regardless.
 */

export const IMAGE_PROMPTS_SCHEMA = {
  type: 'array',
  maxItems: 4,
  description:
    'The photos this article needs: first ONE cover photo, then two or three photos for inside the article, each placed after the section it illustrates. Each is a prompt the shop owner will paste into an AI image generator.',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      place: {
        type: 'string',
        description: 'Where the photo goes: exactly "Cover photo" for the first one; for the others "After the section: <the exact ## heading it illustrates>".',
      },
      prompt: {
        type: 'string',
        description:
          'A detailed prompt for an AI image generator, 50 to 110 words, in English. Describe ONE realistic photograph: the exact subject and what it shows (the part, the machine, the wear or the job being done), the setting (an Indian construction site, quarry, road job or workshop), the light and time of day, the camera angle and distance, and the style ("realistic photograph", "sharp focus"). ' +
          'Machines are generic: say "a yellow backhoe loader", "a crawler excavator", "a hydraulic rock breaker" and never a brand or model name. People, if any, wear helmets, safety boots and high-visibility vests and are shown working safely. ' +
          'End with the shape: "Wide 16:9 format." for the cover photo and "4:3 format." for the others. No logos, brand names or writing in the image.',
      },
      alt: {
        type: 'string',
        description: 'Alt text for the finished photo: one plain sentence under 125 characters saying what it shows, for search engines and screen readers. No "image of".',
      },
    },
    required: ['place', 'prompt', 'alt'],
  },
} as const;

export const PHOTO_GUIDANCE = [
  'Photos: also describe the photos the article needs, as prompts for an AI image generator. The first is a cover photo that would make someone click the article;',
  'the others show exactly what a section explains (a worn chisel next to a new one, where the grease point is, a track being checked). Each must be something a camera',
  'could really capture: no diagrams, no cut-away drawings, no arrows or labels, and no machine shown doing anything unsafe.',
].join(' ');
