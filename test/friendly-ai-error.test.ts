import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aiFailureResponse,
  aiFailureStatus,
  classifyAiFailure,
  friendlyAiErrorMessage,
} from '../lib/ai/friendly-error';

/** Verbatim from Google's SDK, reproduced against the live key while Reference Search was
 *  failing with "The ERP ran into a problem and could not finish that". */
const REAL_QUOTA_ERROR = new Error(
  '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.' +
  ' For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.' +
  ' To monitor your current usage, head to: https://ai.dev/rate-limit. ","status":"RESOURCE_EXHAUSTED"}}'
);

test('the real out-of-quota error is recognised as quota, not an unknown fault', () => {
  assert.equal(classifyAiFailure(REAL_QUOTA_ERROR), 'quota');
});

/** The whole point: a 500 body is replaced with a generic sentence before the owner sees it. */
test('an out-of-quota failure comes back as 503, so its explanation survives the trip', async () => {
  const response = aiFailureResponse(REAL_QUOTA_ERROR, 'Unknown error.');
  assert.equal(response.status, 503);
  const body = await response.json() as { error: string };
  assert.match(body.error, /used up its free allowance/i);
  assert.match(body.error, /billing/i, 'says what would actually fix it');
  assert.doesNotMatch(body.error, /RESOURCE_EXHAUSTED|429/, 'no raw machinery in the message');
});

test('a rejected API key is a setup problem, reported as 501', () => {
  for (const error of [
    new Error('{"error":{"code":400,"message":"API key not valid","status":"INVALID_ARGUMENT"}}'),
    Object.assign(new Error('forbidden'), { status: 403 }),
  ]) {
    assert.equal(classifyAiFailure(error), 'auth');
    assert.equal(aiFailureStatus(classifyAiFailure(error)), 501);
  }
});

test('an overloaded service is 503 and says to try again', () => {
  const error = Object.assign(new Error('{"error":{"status":"UNAVAILABLE"}}'), { status: 503 });
  assert.equal(classifyAiFailure(error), 'unavailable');
  assert.equal(aiFailureStatus('unavailable'), 503);
  assert.match(friendlyAiErrorMessage(error, 'x'), /try again/i);
});

test('a refusal is 502 and suggests what the owner can do instead', () => {
  const error = new Error('{"error":{"message":"blocked for SAFETY"}}');
  assert.equal(classifyAiFailure(error), 'refused');
  assert.equal(aiFailureStatus('refused'), 502);
  assert.match(friendlyAiErrorMessage(error, 'x'), /pick the reference photo yourself/i);
});

/** A genuine unexplained fault should still be a 500 — the generic sentence is honest there. */
test('an unrecognised failure stays a 500 and keeps its own message', async () => {
  const error = new Error('socket hang up');
  assert.equal(classifyAiFailure(error), 'unknown');
  const response = aiFailureResponse(error, 'Unknown error.');
  assert.equal(response.status, 500);
  assert.equal((await response.json() as { error: string }).error, 'socket hang up');
});

test('a non-Error throw falls back to the caller’s own wording', () => {
  assert.equal(friendlyAiErrorMessage('something odd', 'Unknown error searching.'), 'Unknown error searching.');
  assert.equal(classifyAiFailure('something odd'), 'unknown');
});

test('status codes stay inside the range parseJsonOrThrow passes through untouched', () => {
  for (const kind of ['quota', 'auth', 'unavailable', 'refused'] as const) {
    const status = aiFailureStatus(kind);
    assert.ok(status >= 501 && status <= 503, `${kind} -> ${status} must be 501-503 to survive`);
  }
});

/** Measured against the live key on 2026-09-04: a plain text request answered 200 while, seconds
 *  apart, search grounding and image generation both answered 429. Blaming "Google's AI" as a
 *  whole in that state is untrue, and sends the owner hunting for a fault that isn't there. */
test('the quota message names the capability that ran out, not the whole service', async () => {
  const search = await (aiFailureResponse(REAL_QUOTA_ERROR, 'x', 'search')).json() as { error: string };
  assert.match(search.error, /web and image search/i);
  assert.match(search.error, /rest of the app’s AI is unaffected/i);

  const image = await (aiFailureResponse(REAL_QUOTA_ERROR, 'x', 'image')).json() as { error: string };
  assert.match(image.error, /image generation/i);
  assert.doesNotMatch(image.error, /web and image search/i);
});

test('it no longer claims the whole account is out of usage', async () => {
  for (const capability of ['search', 'image'] as const) {
    const body = await (aiFailureResponse(REAL_QUOTA_ERROR, 'x', capability)).json() as { error: string };
    assert.doesNotMatch(body.error, /no free usage left on this account/i);
  }
});

test('without a capability it still says something true and general', async () => {
  const body = await (aiFailureResponse(REAL_QUOTA_ERROR, 'x')).json() as { error: string };
  assert.match(body.error, /Google’s AI has used up its free allowance/i);
});

test('the other failure kinds are unchanged by the capability wording', () => {
  const authError = Object.assign(new Error('forbidden'), { status: 403 });
  assert.equal(
    friendlyAiErrorMessage(authError, 'x', 'search'),
    friendlyAiErrorMessage(authError, 'x', 'image'),
    'only the quota message differs by capability'
  );
});
