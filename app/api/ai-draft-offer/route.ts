import { aiErrorResponse, generateJson } from '@/lib/ai/generate';

export const dynamic = 'force-dynamic';
// The AI layer may legitimately spend ~25s on a slow provider before its own fallback
// resolves; without this the platform could cut the function off first and turn a
// recoverable slow call into an unexplained failure.
export const maxDuration = 60;

const OFFER_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    message: { type: 'string', description: 'The ready-to-send offer message, under 90 words, in the same plain register a parts dealer would actually use with a trade customer.' },
  },
  required: ['message'],
};

/**
 * The split that matters: the OWNER decides the commercial terms, the AI only chooses how to
 * word them for this particular customer. A model inventing "20% off all filters" would be
 * writing a commitment the owner is then bound to honour once it is sent — so the terms are
 * passed in and the prompt is forbidden from adding to them.
 *
 * The customer's internal grade also never appears in the text. "As our Silver customer…" is
 * both insulting and none of their business; the grade shapes the angle and the tone, nothing more.
 */
const SYSTEM_PROMPT =
  'You write short customer offer messages for an Indian auto/heavy-machinery spare parts trading business. ' +
  'You are given the exact offer the owner has decided on, plus an internal note on what kind of customer this is. ' +
  'Your job is ONLY to word that offer well for this customer — never to design it. ' +
  'Absolute rules: state no discount percentage, price, product, quantity, deadline or free item that is not ' +
  'in the offer text you were given; invent no past-purchase specifics, no loyalty claims ("valued since 2019"), ' +
  'no stock claims, and no delivery or warranty promises. If the given offer is vague, keep the message vague ' +
  'rather than inventing specifics to fill it out. ' +
  'NEVER mention the customer\'s internal grade, tier, ranking, or that they are classified at all — that wording ' +
  'is for the owner only and would read as insulting or intrusive to the customer. Use it only to choose the angle: ' +
  'a top-value customer is thanked and offered priority or early access; a discount-driven customer is pointed at ' +
  'bundles and volume value rather than a deeper price cut; a customer who has gone quiet is invited back warmly ' +
  'without guilt-tripping or referencing how long they have been away. ' +
  'Write in plain, warm, businesslike English a parts counter would actually send on WhatsApp — no marketing ' +
  'superlatives, no emoji, no subject line, no placeholder brackets to fill in. Address the customer by the name given.';

export async function POST(request: Request) {
  const { name, offer, tier, flags, orderCount, lastPurchaseDate } = await request.json();

  if (typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }
  // Without terms there is nothing to word, and a model asked to fill the gap would invent an
  // offer the owner never agreed to — the one outcome this route exists to prevent.
  if (typeof offer !== 'string' || !offer.trim()) {
    return Response.json({ error: 'Describe the offer you want to make before drafting a message.' }, { status: 400 });
  }

  const segmentNote = [
    typeof tier === 'string' && tier ? `internal value tier: ${tier}` : null,
    Array.isArray(flags) && flags.length ? `internal behaviour flags: ${flags.join(', ')}` : null,
    Number.isFinite(orderCount) ? `purchases on record: ${orderCount}` : null,
    typeof lastPurchaseDate === 'string' && lastPurchaseDate ? `last purchase: ${lastPurchaseDate}` : null,
  ].filter(Boolean).join('; ');

  try {
    const { data } = await generateJson({
      system: SYSTEM_PROMPT,
      prompt: [
        `Customer name: ${name.trim()}`,
        `Offer the owner has decided on (word this, do not change or extend it): ${offer.trim().slice(0, 500)}`,
        segmentNote ? `Internal context, for choosing the angle only — never mention any of it: ${segmentNote}` : null,
      ].filter(Boolean).join('\n'),
      schema: OFFER_JSON_SCHEMA,
      schemaName: 'customer_offer',
      // Someone is waiting on this with the modal open — lead with the fastest provider.
      priority: 'speed',
    });

    return Response.json(data);
  } catch (error) {
    console.error('ai-draft-offer route failed:', error);
    return aiErrorResponse(error, 'Unknown error drafting this offer.');
  }
}
