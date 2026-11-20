import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyGroqFailure } from '../lib/ai/providers/groq';
import { shouldTryNextProvider } from '../lib/ai/errors';
import { generateJson, registerProvider } from '../lib/ai/generate';
import { AiProviderError } from '../lib/ai/errors';
import type { AiProvider } from '../lib/ai/types';

/** The exact message Groq returned to the owner, which stopped the chain and was shown raw. */
const REAL_MESSAGE = "Failed to validate JSON. Please adjust your prompt. See 'failed_generation' for more details.";

test('a Groq JSON-validation 400 is retryable, so the next provider is asked', () => {
  const kind = classifyGroqFailure(400, REAL_MESSAGE);
  assert.notEqual(kind, 'bad_request', 'must not stop the failover chain');
  assert.equal(shouldTryNextProvider(kind), true);
});

test('a 400 for an unsupported response format also fails over rather than surfacing', () => {
  for (const detail of [
    'response_format json_schema is not supported for this model',
    'json_schema not supported',
  ]) {
    assert.equal(shouldTryNextProvider(classifyGroqFailure(400, detail)), true, detail);
  }
});

test('a genuinely malformed request still stops the chain, as it always did', () => {
  const kind = classifyGroqFailure(400, 'messages: field required');
  assert.equal(kind, 'bad_request');
  assert.equal(shouldTryNextProvider(kind), false);
});

test('other statuses keep their existing meaning', () => {
  assert.equal(classifyGroqFailure(429, 'Rate limit reached'), 'quota');
  assert.equal(classifyGroqFailure(401, 'Invalid API Key'), 'auth');
  assert.equal(classifyGroqFailure(503, 'upstream'), 'transient');
});

/** The behaviour that actually matters: the request still succeeds. */
test('a provider failing this way hands the work to the next one, and the answer comes back', async () => {
  let secondWasAsked = false;

  const failsLikeGroq: AiProvider = {
    name: 'failing-first',
    configured: () => true,
    supports: () => true,
    async generateJson() {
      throw new AiProviderError(
        `Groq 400: ${REAL_MESSAGE}`,
        classifyGroqFailure(400, REAL_MESSAGE),
        'failing-first',
        400
      );
    },
  };

  const answers: AiProvider = {
    name: 'answers-second',
    configured: () => true,
    supports: () => true,
    async generateJson() {
      secondWasAsked = true;
      return { text: JSON.stringify({ items: [{ name: 'Hydraulic Pump' }] }), model: 'stub' };
    },
  };

  registerProvider('failing-first', failsLikeGroq);
  registerProvider('answers-second', answers);
  process.env.AI_PROVIDER_ORDER = 'failing-first,answers-second';
  process.env.AI_HEDGE_MS = '0'; // sequential, so the assertion is about failover and not a race

  const { data, provider } = await generateJson<{ items: { name: string }[] }>({
    system: 'test',
    prompt: 'test',
    schema: { type: 'object', properties: { items: { type: 'array' } }, required: ['items'] },
    schemaName: 'test',
  });

  assert.equal(secondWasAsked, true, 'the second provider should have been asked');
  assert.equal(provider, 'answers-second');
  assert.equal(data.items[0].name, 'Hydraulic Pump');
});

/** A blog article takes Gemini 15 to 30 seconds. With the usual few-second head start the backup
 *  always finished first; a request can now give the first provider longer. */
test('a request can keep the provider order and give the first one a longer head start, so the slower better writer finishes first', async () => {
  const asked: string[] = [];
  const provider = (name: string, delay: number): AiProvider => ({
    name,
    configured: () => true,
    supports: () => true,
    async generateJson(_request, signal) {
      asked.push(name);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
      });
      return { text: JSON.stringify({ by: name }), model: name };
    },
  });
  registerProvider('writes-well-slowly', provider('writes-well-slowly', 150));
  registerProvider('backup-fast', provider('backup-fast', 5));
  process.env.AI_PROVIDER_ORDER = 'writes-well-slowly,backup-fast';
  process.env.AI_HEDGE_MS = '20';
  const request = { system: 'test', prompt: 'test', schema: { type: 'object', properties: { by: { type: 'string' } }, required: ['by'] }, schemaName: 'test', keepOrder: true };

  const usual = await generateJson<{ by: string }>(request);
  assert.equal(usual.data.by, 'backup-fast', 'with the usual short head start the backup wins the race');

  asked.length = 0;
  const patient = await generateJson<{ by: string }>({ ...request, hedgeMs: 1_000 });
  assert.equal(patient.data.by, 'writes-well-slowly');
  assert.deepEqual(asked, ['writes-well-slowly'], 'the backup is never started when the first answers within its head start');
});
