/**
 * OpenRouter (lib/ai/providers/openrouter.ts): the fourth AI provider, a backup asked only after
 * Gemini, Groq and Cerebras. Free models there come and go, so a short list is tried in turn.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateJson, registerProvider } from '../lib/ai/generate';
import { DEFAULT_OPENROUTER_MODELS, isModelSpecificFailure, openRouterModels, openRouterProvider } from '../lib/ai/providers/openrouter';
import type { AiProvider } from '../lib/ai/types';

type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

/** Replaces fetch for one test: each call is answered by the next of `answers`. */
async function withFetch<T>(answers: Array<() => Response>, run: (sent: Sent[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const sent: Sent[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const next = answers[sent.length - 1];
    if (!next) throw new Error('more requests than expected');
    return next();
  }) as typeof fetch;
  try {
    return await run(sent);
  } finally {
    globalThis.fetch = real;
  }
}

const ok = (content: string) => () => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200 });
const fail = (status: number, message: string) => () => new Response(JSON.stringify({ error: { message } }), { status });
const request = { system: 'Be brief.', prompt: 'Name a part.', schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, schemaName: 'part' };
const signal = new AbortController().signal;

test('it is used only with a key, for text, and as a backup', () => {
  const saved = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  assert.equal(openRouterProvider.configured(), false);
  process.env.OPENROUTER_API_KEY = 'test-key';
  assert.equal(openRouterProvider.configured(), true);
  if (saved === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = saved;
  assert.equal(openRouterProvider.supports({ ...request, attachments: [{ base64: 'x', mimeType: 'image/png' }] }), false, 'invoice photos stay with Gemini and Groq');
  assert.equal(openRouterProvider.supports(request), true);
  assert.equal(openRouterProvider.backupOnly, true);
});

test('the request asks for strict JSON, only from hosts that honour it, with the key', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENROUTER_MODEL;
  await withFetch([ok('{"name":"Pin"}')], async (sent) => {
    const result = await openRouterProvider.generateJson(request, signal);
    assert.deepEqual(result, { text: '{"name":"Pin"}', model: DEFAULT_OPENROUTER_MODELS[0] });
    assert.equal(sent[0].url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(sent[0].headers.Authorization, 'Bearer test-key');
    assert.equal(sent[0].body.model, DEFAULT_OPENROUTER_MODELS[0]);
    assert.deepEqual(sent[0].body.provider, { require_parameters: true });
    const format = sent[0].body.response_format as { type: string; json_schema: { name: string; strict: boolean } };
    assert.equal(format.type, 'json_schema');
    assert.equal(format.json_schema.name, 'part');
    assert.equal(format.json_schema.strict, true);
    assert.deepEqual((sent[0].body.messages as Array<{ role: string }>).map((message) => message.role), ['system', 'user']);
  });
});

test('a model that is gone, busy or cannot give strict JSON is passed over for the next', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENROUTER_MODEL;
  await withFetch([
    fail(404, `${DEFAULT_OPENROUTER_MODELS[0]} is not a valid model ID`),
    fail(429, 'Rate limit exceeded: free-models-per-min'),
    fail(400, 'No endpoints found that support the requested parameters'),
    ok('{"name":"Bush"}'),
  ], async (sent) => {
    const result = await openRouterProvider.generateJson(request, signal);
    assert.equal(result.model, DEFAULT_OPENROUTER_MODELS[3]);
    assert.deepEqual(sent.map((call) => call.body.model), DEFAULT_OPENROUTER_MODELS);
  });
});

test('a bad key or no credit stops at once: every model would say the same', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  for (const [status, kind] of [[401, 'auth'], [402, 'quota']] as const) {
    await withFetch([fail(status, status === 401 ? 'No auth credentials found' : 'Insufficient credits')], async (sent) => {
      await assert.rejects(openRouterProvider.generateJson(request, signal), (error: { kind?: string }) => {
        assert.equal(sent.length, 1);
        return typeof error.kind === 'string';
      });
    });
    assert.ok(kind);
  }
});

test('when every model is busy, the last failure is reported', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_MODEL = 'a/one:free, b/two:free';
  assert.deepEqual(openRouterModels(), ['a/one:free', 'b/two:free'], 'OPENROUTER_MODEL replaces the list');
  await withFetch([fail(429, 'busy'), fail(503, 'upstream down')], async (sent) => {
    await assert.rejects(openRouterProvider.generateJson(request, signal), /OpenRouter 503 \(b\/two:free\)/);
    assert.equal(sent.length, 2);
  });
  delete process.env.OPENROUTER_MODEL;
});

test('which failures are about one model rather than the key', () => {
  assert.equal(isModelSpecificFailure(404, 'not found'), true);
  assert.equal(isModelSpecificFailure(429, 'rate limit'), true);
  assert.equal(isModelSpecificFailure(502, 'bad gateway'), true);
  assert.equal(isModelSpecificFailure(400, 'x is not a valid model ID'), true);
  assert.equal(isModelSpecificFailure(400, 'messages: field required'), false);
  assert.equal(isModelSpecificFailure(401, 'bad key'), false);
  assert.equal(isModelSpecificFailure(402, 'no credit'), false);
});

test('the backup is asked last and never first, even when the configured order leaves it out', async () => {
  const asked: string[] = [];
  const stub = (name: string, answer: 'ok' | 'fail', backupOnly = false): AiProvider => ({
    name,
    backupOnly,
    configured: () => true,
    supports: () => true,
    async generateJson() {
      asked.push(name);
      if (answer === 'fail') throw Object.assign(new Error(`${name} is out of allowance`), { kind: 'quota', provider: name });
      return { text: JSON.stringify({ by: name }), model: name };
    },
  });
  registerProvider('first-spent', stub('first-spent', 'fail'));
  registerProvider('second-spent', stub('second-spent', 'fail'));
  registerProvider('openrouter', stub('openrouter', 'ok', true));
  // An order saved before OpenRouter existed, and the rotation left on: it must still come last.
  process.env.AI_PROVIDER_ORDER = 'first-spent,second-spent';
  process.env.AI_HEDGE_MS = '0';
  delete process.env.AI_ROTATE;
  for (let run = 0; run < 6; run += 1) {
    asked.length = 0;
    const result = await generateJson<{ by: string }>({ ...request, schemaName: 'test' });
    assert.equal(result.data.by, 'openrouter');
    assert.equal(asked[asked.length - 1], 'openrouter');
    assert.notEqual(asked[0], 'openrouter', 'never rotated to go first');
  }
  registerProvider('openrouter', openRouterProvider);
});
