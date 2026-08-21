/** Why a provider call failed, in terms the failover loop can act on. The distinction that
 *  matters most: `bad_request` means *we* sent something wrong, so trying another provider
 *  would only hide our own bug — everything else is worth retrying elsewhere. */
export type AiFailureKind =
  | 'quota'       // rate-limited or out of free allowance
  | 'transient'   // 5xx, network drop, timeout
  | 'blocked'     // safety filter refused the content
  | 'empty'       // answered, but with nothing usable
  | 'auth'        // key missing/invalid/revoked
  | 'bad_request' // malformed request — our fault
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
  if (status === 400 || status === 404 || status === 422) return 'bad_request';
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
    case 'auth': return 60 * 60 * 1000;
    case 'transient': return 60 * 1000;
    default: return 0;
  }
}
