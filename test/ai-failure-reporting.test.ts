import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AiProviderError, classifyStatus, cooldownMs, describeAttempts, providerLabel,
  shouldTryNextProvider, type AiFailureKind,
} from '../lib/ai/errors';
import { generateJson, registerProvider } from '../lib/ai/generate';
import type { AiProvider } from '../lib/ai/types';

// ── A retired model is that provider's problem, not ours ──────────────────────────────────────

/** The bug: 404 was grouped with 400 as "our fault", and our-fault failures deliberately stop the
 *  chain because they fail identically everywhere. But a 404 from an OpenAI-compatible endpoint
 *  means "no such model" — this provider's configured model name has been retired or renamed. That
 *  says nothing about whether anyone else can do the job, and it took a working feature down while
 *  a healthy provider sat untried. */
test('a missing model lets the next provider be tried', () => {
  assert.equal(classifyStatus(404), 'model_missing');
  assert.equal(shouldTryNextProvider('model_missing'), true);
});

test('a request we genuinely built wrong still stops the chain', () => {
  assert.equal(classifyStatus(400), 'bad_request');
  assert.equal(classifyStatus(422), 'bad_request');
  assert.equal(shouldTryNextProvider('bad_request'), false);
});

test('the other statuses keep their meaning', () => {
  assert.equal(classifyStatus(429), 'quota');
  assert.equal(classifyStatus(401), 'auth');
  assert.equal(classifyStatus(403), 'auth');
  assert.equal(classifyStatus(500), 'transient');
  assert.equal(classifyStatus(503), 'transient');
});

/** Both need somebody to change a setting before they can work again, so there is no point asking
 *  repeatedly in the meantime. */
test('a missing model puts that provider aside for as long as a bad key does', () => {
  assert.equal(cooldownMs('model_missing'), 60 * 60 * 1000);
  assert.equal(cooldownMs('auth'), 60 * 60 * 1000);
  assert.equal(cooldownMs('quota'), 10 * 60 * 1000);
  assert.equal(cooldownMs('transient'), 60 * 1000);
  assert.equal(cooldownMs('bad_request'), 0);
});

/** The behaviour that actually matters: the feature still works. */
test('a provider whose model is gone hands the work on, and the answer comes back', async () => {
  let secondWasAsked = false;

  const modelRetired: AiProvider = {
    name: 'retired-model',
    configured: () => true,
    supports: () => true,
    async generateJson() {
      throw new AiProviderError('404 model_not_found', classifyStatus(404), 'retired-model', 404);
    },
  };

  const answers: AiProvider = {
    name: 'still-works',
    configured: () => true,
    supports: () => true,
    async generateJson() {
      secondWasAsked = true;
      return { text: JSON.stringify({ items: [{ name: 'Slew Motor' }] }), model: 'stub' };
    },
  };

  registerProvider('retired-model', modelRetired);
  registerProvider('still-works', answers);
  process.env.AI_PROVIDER_ORDER = 'retired-model,still-works';
  process.env.AI_HEDGE_MS = '0'; // sequential, so this asserts failover rather than a race
  process.env.AI_ROTATE = 'off'; // and the order is the order, so "next" means next

  const { data, provider } = await generateJson<{ items: { name: string }[] }>({
    system: 'test',
    prompt: 'test',
    schema: { type: 'object', properties: { items: { type: 'array' } }, required: ['items'] },
    schemaName: 'test',
  });

  assert.equal(secondWasAsked, true, 'the second provider should have been asked');
  assert.equal(provider, 'still-works');
  assert.equal(data.items[0].name, 'Slew Motor');
});

// ── Saying what actually happened ─────────────────────────────────────────────────────────────

const attempt = (provider: string, kind: AiFailureKind) => ({ provider, kind });

test('services are named the way the owner knows them', () => {
  assert.equal(providerLabel('gemini'), 'Google');
  assert.equal(providerLabel('groq'), 'Groq');
  assert.equal(providerLabel('cerebras'), 'Cerebras');
  assert.equal(providerLabel('something-else'), 'something-else');
});

test('when they really are all out of usage, it says so', () => {
  const message = describeAttempts([
    attempt('gemini', 'quota'), attempt('groq', 'quota'), attempt('cerebras', 'quota'),
  ]);
  assert.match(message, /Every AI service has used up its free usage/);
});

/** The message this replaces said "Every AI service is at its usage limit right now" whenever ANY
 *  attempt hit a quota. A run where Google was out of allowance and Groq's key was wrong therefore
 *  told the owner to wait a few minutes for a limit to reset, when the real fix was a key — waiting
 *  would never have helped. */
test('a mix of reasons names each service and its own reason', () => {
  const message = describeAttempts([attempt('gemini', 'quota'), attempt('groq', 'auth')]);
  assert.match(message, /Google has used up its free usage/);
  assert.match(message, /Groq rejected the key/);
  assert.doesNotMatch(message, /Every AI service/, 'only one of them was out of usage');
});

test('one service out of usage is not described as all of them', () => {
  const message = describeAttempts([attempt('gemini', 'quota')]);
  assert.match(message, /^Google has used up its free usage/);
  assert.doesNotMatch(message, /Every/);
});

test('a retired model reads as a setting to fix, not as an outage to wait out', () => {
  const message = describeAttempts([attempt('groq', 'model_missing'), attempt('cerebras', 'transient')]);
  assert.match(message, /Groq no longer offers the model it is set to use/);
  assert.match(message, /Cerebras could not be reached/);
});

test('every key being rejected says which settings to check', () => {
  const message = describeAttempts([attempt('gemini', 'auth'), attempt('groq', 'auth')]);
  assert.match(message, /GEMINI_API_KEY/);
  assert.match(message, /GROQ_API_KEY/);
});

test('content the AI refuses is reported as content, not as an outage', () => {
  const message = describeAttempts([attempt('gemini', 'blocked'), attempt('groq', 'blocked')]);
  assert.match(message, /declined to work with this content/);
});

test('each service is named once even if it was tried twice', () => {
  const message = describeAttempts([
    attempt('gemini', 'transient'), attempt('gemini', 'transient'), attempt('groq', 'quota'),
  ]);
  assert.equal(message.match(/Google/g)?.length, 1);
});

test('nothing attempted still produces a sentence, not an empty error', () => {
  assert.match(describeAttempts([]), /could not be reached/);
});
