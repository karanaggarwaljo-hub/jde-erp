/** Short-term memory of which providers just failed, so a provider that is rate-limited for the
 *  next few minutes isn't re-tried on every single request while the user waits.
 *
 *  Deliberately in-memory only: it is an optimisation, not state worth persisting. On Vercel each
 *  serverless instance keeps its own copy and a cold start forgets everything — the worst case is
 *  one wasted call that fails over exactly as it would have anyway. */

const cooldowns = new Map<string, number>();

export function markUnavailable(provider: string, ms: number): void {
  if (ms <= 0) return;
  cooldowns.set(provider, Date.now() + ms);
}

export function isAvailable(provider: string): boolean {
  const until = cooldowns.get(provider);
  if (until === undefined) return true;
  if (Date.now() >= until) {
    cooldowns.delete(provider);
    return true;
  }
  return false;
}

/** Cleared on a success — a provider that just answered is healthy whatever we thought before. */
export function markHealthy(provider: string): void {
  cooldowns.delete(provider);
}
