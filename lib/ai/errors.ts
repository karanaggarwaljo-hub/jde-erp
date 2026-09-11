/** Why a provider call failed, in terms the failover loop can act on. The distinction that
 *  matters most: `bad_request` means *we* sent something wrong, so trying another provider
 *  would only hide our own bug — everything else is worth retrying elsewhere. */
export type AiFailureKind =
  | 'quota'         // rate-limited or out of free allowance
  | 'transient'     // 5xx, network drop, timeout
  | 'blocked'       // safety filter refused the content
  | 'empty'         // answered, but with nothing usable
  | 'auth'          // key missing/invalid/revoked
  | 'model_missing' // this provider has no such model — retired, renamed, or never had it
  | 'bad_request'   // malformed request — our fault
  | 'unknown';

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly kind: AiFailureKind,
    readonly provider: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/** Thrown once every eligible provider has failed. Carries the per-provider detail for the
 *  server log while `message` stays plain enough to show a non-technical user. */
export class AiUnavailableError extends Error {
  constructor(message: string, readonly attempts: { provider: string; kind: AiFailureKind; message: string }[]) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

export function classifyStatus(status: number): AiFailureKind {
  if (status === 429) return 'quota';
  if (status === 401 || status === 403) return 'auth';
  // 404 is NOT our fault, and used to be treated as one. From an OpenAI-compatible endpoint it
  // means "no such model" — the name this provider is configured with has been retired or renamed.
  // Grouped with bad_request it stopped the whole chain, so one provider's retired model could
  // take down a feature while a working provider sat untried. It is the one failure that says
  // nothing at all about whether somebody else can do the job.
  if (status === 404) return 'model_missing';
  if (status === 400 || status === 422) return 'bad_request';
  if (status >= 500) return 'transient';
  return 'unknown';
}

/** Last-resort classification for errors that carry no status — SDK wrappers, fetch failures,
 *  aborts. Gemini in particular reports quota exhaustion as a JSON blob inside error.message. */
export function classifyError(error: unknown): AiFailureKind {
  if (error instanceof AiProviderError) return error.kind;

  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  // Checked before the status code on purpose: Google reports an invalid or revoked key as a
  // 400 INVALID_ARGUMENT, which would otherwise look like a malformed request of our own and
  // stop the failover chain — the one situation where falling through matters most.
  if (/API_KEY_INVALID|api.?key not valid|invalid api.?key|unauthorized|permission denied/i.test(raw)) return 'auth';

  const status = (error as { status?: unknown })?.status;
  if (typeof status === 'number') return classifyStatus(status);

  if (/RESOURCE_EXHAUSTED|rate.?limit|quota|too many requests|\b429\b/i.test(raw)) return 'quota';
  if (/AbortError|timed? ?out|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(raw)) return 'transient';
  if (/\b401\b|\b403\b/.test(raw)) return 'auth';
  return 'unknown';
}

/** How an OpenAI-compatible provider's HTTP failure should be treated by the failover chain.
 *
 *  classifyStatus maps every 400 to bad_request, which deliberately STOPS the chain on the
 *  grounds that a malformed request fails identically everywhere. That reasoning does not hold
 *  for two cases: "failed to validate JSON" means this model produced a bad answer, and an
 *  unsupported or over-large response_format means this model lacks a feature. Neither says
 *  anything about whether another provider can do the job. Left as bad_request they surface a
 *  raw provider error to the owner while a working provider sits untried — which is exactly what
 *  happened once with Groq. Classed as `empty` they are retryable, so the next provider is asked.
 *
 *  Shared by every provider that speaks the OpenAI chat API (Groq, Cerebras). */
export function classifyOpenAiCompatibleFailure(status: number, detail: string): AiFailureKind {
  const providerFailedTheTask = /failed_generation|failed to validate json|response_format|json_schema|schema is too|not supported/i.test(detail);
  if (status === 400 && providerFailedTheTask) return 'empty';
  return classifyStatus(status);
}

/** A wrong key or a malformed request will fail identically everywhere, so only the first
 *  costs us a call — but a bad key shouldn't stop the *other* providers from being tried. */
export function shouldTryNextProvider(kind: AiFailureKind): boolean {
  return kind !== 'bad_request';
}

/** How long to stop routing to a provider that just failed. Quota errors last minutes, so
 *  skipping that provider outright is faster than paying the round trip to be refused again. */
export function cooldownMs(kind: AiFailureKind): number {
  switch (kind) {
    case 'quota': return 10 * 60 * 1000;
    // Both need somebody to change a setting before they can work again, so there is no point
    // asking either of them repeatedly in the meantime.
    case 'auth': return 60 * 60 * 1000;
    case 'model_missing': return 60 * 60 * 1000;
    case 'transient': return 60 * 1000;
    default: return 0;
  }
}

/** What each service is called when the owner reads about it. Nobody outside the code calls it
 *  "gemini". An unknown key is passed through rather than dropped — a name is more use than a gap. */
const PROVIDER_NAMES: Record<string, string> = {
  gemini: 'Google',
  groq: 'Groq',
  cerebras: 'Cerebras',
};

export function providerLabel(provider: string): string {
  return PROVIDER_NAMES[provider.toLowerCase()] ?? provider;
}

/** Why one service could not answer, in words the owner can act on. */
const KIND_REASONS: Record<AiFailureKind, string> = {
  quota: 'has used up its free usage for now',
  transient: 'could not be reached',
  blocked: 'refused this content',
  empty: 'answered with nothing usable',
  auth: 'rejected the key it was given',
  model_missing: 'no longer offers the model it is set to use',
  bad_request: 'rejected the request',
  unknown: 'failed for an unknown reason',
};

/**
 * One sentence naming what actually happened to each service.
 *
 * The message this replaces said "Every AI service is at its usage limit right now" whenever ANY
 * attempt hit a quota — so a run where Google was out of allowance and Groq's key was wrong told
 * the owner to wait a few minutes for a limit to reset, when the real fix was a key. Waiting would
 * never have helped. Naming each service and its own reason is both shorter to read and actually
 * actionable.
 */
export function describeAttempts(attempts: { provider: string; kind: AiFailureKind }[]): string {
  if (attempts.length === 0) return 'The AI service could not be reached right now — please try again in a few minutes.';

  if (attempts.every((attempt) => attempt.kind === 'blocked')) {
    return 'The AI declined to work with this content. Try rephrasing it or entering the details manually.';
  }
  if (attempts.every((attempt) => attempt.kind === 'quota')) {
    return attempts.length === 1
      ? `${providerLabel(attempts[0].provider)} has used up its free usage for now — please try again in a few minutes.`
      : 'Every AI service has used up its free usage for now — please try again in a few minutes.';
  }
  if (attempts.every((attempt) => attempt.kind === 'auth')) {
    return 'None of the AI services accepted the key this ERP is using. Check GEMINI_API_KEY, GROQ_API_KEY and CEREBRAS_API_KEY.';
  }

  // Mixed, or all of some other single kind: say which service did what, once each, in the order
  // they were tried.
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const attempt of attempts) {
    const label = providerLabel(attempt.provider);
    if (seen.has(label)) continue;
    seen.add(label);
    parts.push(`${label} ${KIND_REASONS[attempt.kind]}`);
  }
  return `No AI service could answer: ${parts.join(', ')}.`;
}
