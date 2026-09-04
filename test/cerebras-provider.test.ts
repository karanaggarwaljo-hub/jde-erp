import assert from 'node:assert/strict';
import test from 'node:test';
import { cerebrasProvider } from '../lib/ai/providers/cerebras';
import { classifyOpenAiCompatibleFailure, shouldTryNextProvider } from '../lib/ai/errors';
import { classifyGroqFailure } from '../lib/ai/providers/groq';

test('the provider is skipped, not failed, when no key is configured', () => {
  const before = process.env.CEREBRAS_API_KEY;
  delete process.env.CEREBRAS_API_KEY;
  assert.equal(cerebrasProvider.configured(), false);
  process.env.CEREBRAS_API_KEY = 'test-key';
  assert.equal(cerebrasProvider.configured(), true);
  if (before === undefined) delete process.env.CEREBRAS_API_KEY;
  else process.env.CEREBRAS_API_KEY = before;
});

/** The one that matters: Cerebras' public models read no images, so an invoice photo routed
 *  here would fail for a reason nobody could act on. */
test('an invoice photo is never routed to Cerebras', () => {
  const withPhoto = {
    prompt: 'read this',
    schema: {},
    attachments: [{ base64: 'x', mimeType: 'image/jpeg' }],
  };
  assert.equal(cerebrasProvider.supports(withPhoto), false);

  const withPdf = { prompt: 'read this', schema: {}, attachments: [{ base64: 'x', mimeType: 'application/pdf' }] };
  assert.equal(cerebrasProvider.supports(withPdf), false);
});

test('an ordinary text request is accepted', () => {
  assert.equal(cerebrasProvider.supports({ prompt: 'summarise', schema: {} }), true);
  assert.equal(cerebrasProvider.supports({ prompt: 'summarise', schema: {}, attachments: [] }), true);
});

test('a schema Cerebras refuses as too large keeps the failover chain alive', () => {
  // Cerebras caps a strict schema at 5,000 characters; past that it answers 400. That is this
  // provider lacking capacity for this request, not a malformed request of ours.
  for (const detail of [
    'schema is too large: 6210 characters exceeds the 5000 character limit',
    'response_format json_schema is not supported for this model',
    "Failed to validate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
  ]) {
    const kind = classifyOpenAiCompatibleFailure(400, detail);
    assert.notEqual(kind, 'bad_request', detail);
    assert.equal(shouldTryNextProvider(kind), true, detail);
  }
});

test('a genuinely malformed request still stops the chain', () => {
  const kind = classifyOpenAiCompatibleFailure(400, 'messages: field required');
  assert.equal(kind, 'bad_request');
  assert.equal(shouldTryNextProvider(kind), false);
});

test('other statuses keep their existing meaning', () => {
  assert.equal(classifyOpenAiCompatibleFailure(429, 'daily token limit reached'), 'quota');
  assert.equal(classifyOpenAiCompatibleFailure(401, 'invalid api key'), 'auth');
  assert.equal(classifyOpenAiCompatibleFailure(503, 'upstream'), 'transient');
});

/** Groq's own classifier now delegates here — the behaviour it had must not have drifted. */
test('Groq classification is unchanged by sharing the rule with Cerebras', () => {
  const realGroqMessage = "Failed to validate JSON. Please adjust your prompt. See 'failed_generation' for more details.";
  assert.equal(classifyGroqFailure(400, realGroqMessage), 'empty');
  assert.equal(classifyGroqFailure(400, 'messages: field required'), 'bad_request');
  assert.equal(classifyGroqFailure(429, 'Rate limit reached'), 'quota');
});
