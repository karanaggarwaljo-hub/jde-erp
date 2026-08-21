/**
 * Proves the AI fallback chain actually works, without needing a login or the dev server.
 *
 *   npx tsx scripts/ai-fallback-check.ts
 *
 * Checks, in order:
 *   1. each configured provider answers correctly on its own
 *   2. the quality and speed paths each answer, and report which provider won
 *   3. a primary that hangs is overtaken by the hedge rather than holding the request
 *   4. a deliberately broken primary key falls through to the next provider
 *   5. every provider broken produces one plain-language error, not a crash
 *
 * It spends a few real API calls (a couple of sentences each), so it is a manual check to run
 * after touching lib/ai — not something wired into a build.
 */
import { readFileSync } from 'node:fs';
import { generateJson, registerProvider } from '../lib/ai/generate';
import { AiUnavailableError } from '../lib/ai/errors';
import type { AiJsonRequest } from '../lib/ai/types';

/** A provider that accepts the request and then never answers, so the hedge has something
 *  unambiguous to beat. Only ever registered here, never in the app. */
registerProvider('stall', {
  name: 'stall',
  configured: () => true,
  supports: () => true,
  generateJson: (_request, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('stall provider aborted')));
    }),
});

// Loaded by hand: this runs as a plain Node script, outside Next's env handling.
function loadEnvLocal(): void {
  let contents: string;
  try {
    contents = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  } catch {
    console.error('No .env.local found next to package.json — nothing to test with.');
    process.exit(1);
  }
  for (const line of contents.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: { type: 'string', enum: ['transport', 'office', 'other'] },
    reason: { type: 'string', description: 'One short sentence.' },
    // Present only to exercise the keyword-stripping in toStrictJsonSchema().
    tags: { type: 'array', maxItems: 3, items: { type: 'string' } },
  },
  required: ['category', 'reason', 'tags'],
};

const REQUEST: AiJsonRequest = {
  system: 'You categorize expenses for an auto parts business.',
  prompt: 'Expense description: "paid courier charges for sending parts to Ludhiana"',
  schema: SCHEMA,
  schemaName: 'expense_category',
};

type Answer = { category: string; reason: string; tags: string[] };

async function check(
  label: string,
  env: Record<string, string>,
  expect: 'ok' | 'fail',
  overrides: Partial<typeof REQUEST> = {}
): Promise<boolean> {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  const started = Date.now();
  try {
    const { data, provider, model } = await generateJson<Answer>({ ...REQUEST, ...overrides });
    const ms = Date.now() - started;
    if (expect === 'fail') {
      console.log(`FAIL  ${label} — expected an error, got an answer from ${provider}`);
      return false;
    }
    const sane = data.category === 'transport';
    console.log(
      `${sane ? 'PASS' : 'WARN'}  ${label} — ${provider} (${model}) in ${ms}ms → ` +
        `category=${data.category}, tags=${data.tags.length}`
    );
    if (!sane) console.log(`      expected category "transport", got "${data.category}"`);
    return sane;
  } catch (error) {
    if (expect === 'fail' && error instanceof AiUnavailableError) {
      console.log(`PASS  ${label} — refused cleanly: "${error.message}"`);
      return true;
    }
    console.log(`FAIL  ${label} — ${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    process.env = saved;
  }
}

async function main(): Promise<void> {
  loadEnvLocal();

  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasGroq = Boolean(process.env.GROQ_API_KEY);
  console.log(`Configured: gemini=${hasGemini ? 'yes' : 'NO'}, groq=${hasGroq ? 'yes' : 'NO'}\n`);

  const results: boolean[] = [];

  if (hasGemini) results.push(await check('gemini alone', { AI_PROVIDER_ORDER: 'gemini' }, 'ok'));
  if (hasGroq) results.push(await check('groq alone', { AI_PROVIDER_ORDER: 'groq' }, 'ok'));

  if (hasGemini && hasGroq) {
    // Run before the broken-key check below: that one leaves gemini marked unavailable for an
    // hour, which would make these lines report groq for a reason the real app never hits.
    // Which provider answers depends on whether Google is healthy — either is a pass.
    results.push(await check('quality priority, real keys', {}, 'ok'));
    results.push(await check('speed priority, real keys', {}, 'ok', { priority: 'speed' }));

    // A primary that hangs must not hold the request for its full timeout: the hedge should
    // start the second provider alongside it and return that answer instead.
    results.push(
      await check('hedge (primary stalls)', { AI_PROVIDER_ORDER: 'stall,groq', AI_HEDGE_MS: '500' }, 'ok')
    );

    results.push(
      await check('failover (gemini key broken)', { AI_PROVIDER_ORDER: 'gemini,groq', GEMINI_API_KEY: 'broken-on-purpose' }, 'ok')
    );
  }

  results.push(
    await check(
      'all providers broken',
      { AI_PROVIDER_ORDER: 'gemini,groq', GEMINI_API_KEY: 'broken-on-purpose', GROQ_API_KEY: 'broken-on-purpose' },
      'fail'
    )
  );

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  if (!hasGroq) console.log('Add GROQ_API_KEY to .env.local to test the actual fallback path.');
  process.exit(failed ? 1 : 0);
}

void main();
