/**
 * Checks that the offer drafter words the owner's terms without inventing new ones, and without
 * telling the customer their internal grade.
 *
 *   npx tsx scripts/offer-draft-check.ts
 *
 * This calls a real AI provider, so it costs a few requests and its output is not deterministic —
 * the assertions are therefore about what must NEVER appear (invented numbers, the internal tier
 * word) rather than exact wording. That is the property worth defending: a drafted offer is a
 * commitment the owner has to honour once it is sent.
 */
import { readFileSync } from 'node:fs';
import { generateJson } from '../lib/ai/generate';

function loadEnvLocal(): void {
  try {
    const contents = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of contents.split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    console.error('No .env.local found — cannot reach an AI provider.');
    process.exit(1);
  }
}

// Kept in step with app/api/ai-draft-offer/route.ts by hand; this script exercises the same
// contract that route relies on, not the route itself (which needs a logged-in session).
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

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { message: { type: 'string', description: 'The offer message, under 90 words.' } },
  required: ['message'],
};

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function draft(name: string, offer: string, segmentNote: string): Promise<string> {
  const { data } = await generateJson<{ message: string }>({
    system: SYSTEM_PROMPT,
    prompt: [
      `Customer name: ${name}`,
      `Offer the owner has decided on (word this, do not change or extend it): ${offer}`,
      `Internal context, for choosing the angle only — never mention any of it: ${segmentNote}`,
    ].join('\n'),
    schema: SCHEMA,
    schemaName: 'customer_offer',
    priority: 'speed',
  });
  return data.message;
}

async function main(): Promise<void> {
  loadEnvLocal();

  // A deliberately vague offer: the model must not fill the gap with a number of its own.
  const vague = await draft('Sharma Motors', 'a small discount on his next order', 'internal value tier: diamond; purchases on record: 14');
  console.log(`\n  vague-offer draft: ${vague}\n`);
  check('vague offer stays vague — no invented percentage', !/\d+\s*%/.test(vague), vague);
  check('vague offer invents no rupee amount', !/₹\s*\d/.test(vague), vague);
  check('never tells the customer their tier', !/\b(diamond|gold|silver|tier|grade|ranked?|classif)/i.test(vague), vague);

  // A concrete offer: the stated terms should survive into the message.
  const concrete = await draft('Bawa Traders', '5% off on orders above ₹20,000 during September', 'internal value tier: silver; internal behaviour flags: bargainer');
  console.log(`  concrete-offer draft: ${concrete}\n`);
  check("concrete offer keeps the owner's percentage", /5\s*%/.test(concrete), concrete);
  check('concrete offer keeps the threshold', /20[,.]?000/.test(concrete), concrete);
  check('bargainer draft still hides the internal label', !/\b(bargain|silver|tier|grade|classif)/i.test(concrete), concrete);

  // A dormant customer: warmth without guilt-tripping about the gap.
  const dormant = await draft('Verma Auto', 'free delivery on the next order', 'internal behaviour flags: dormant; last purchase: 2026-02-10');
  console.log(`  dormant-offer draft: ${dormant}\n`);
  check('dormant draft mentions the real offer', /deliver/i.test(dormant), dormant);
  check('dormant draft does not name the internal flag', !/\bdormant\b/i.test(dormant), dormant);

  console.log(`\n${passed}/${passed + failed} checks passed.`);
  process.exit(failed ? 1 : 0);
}

void main();
