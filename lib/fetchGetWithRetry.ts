/**
 * A small retry wrapper for idempotent reads. It deliberately never retries writes: retrying a
 * POST/PATCH after a network failure could save an invoice or stock movement twice. Keeping the
 * retry policy here also prevents every page from inventing a different tight retry loop when a
 * host/database momentarily returns 429/503.
 */
const RETRIABLE_STATUSES = new Set([429, 502, 503, 504]);
const FALLBACK_DELAYS_MS = [400, 1_000];

function delayFor(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('Retry-After');
  const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) {
    // Respect the server but avoid pinning the UI for an unexpectedly large value.
    return Math.min(seconds * 1_000, 5_000);
  }
  return FALLBACK_DELAYS_MS[attempt] ?? FALLBACK_DELAYS_MS[FALLBACK_DELAYS_MS.length - 1];
}

export async function fetchGetWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let lastNetworkError: unknown;

  for (let attempt = 0; attempt <= FALLBACK_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(input, { ...init, method: 'GET' });
      if (!RETRIABLE_STATUSES.has(response.status) || attempt === FALLBACK_DELAYS_MS.length) {
        return response;
      }
      // There is no useful body to consume on a response we are about to replace. Cancelling it
      // frees the connection before the retry, especially important on a small serverless pool.
      void response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, delayFor(response, attempt)));
    } catch (error) {
      lastNetworkError = error;
      if (attempt === FALLBACK_DELAYS_MS.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, FALLBACK_DELAYS_MS[attempt]));
    }
  }

  throw lastNetworkError instanceof Error ? lastNetworkError : new Error('Unable to reach the ERP.');
}
