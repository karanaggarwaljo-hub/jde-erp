import { AiProviderError, AiUnavailableError, classifyError, cooldownMs, shouldTryNextProvider, type AiFailureKind } from './errors';
import { isAvailable, markHealthy, markUnavailable } from './health';
import { geminiProvider } from './providers/gemini';
import { groqProvider } from './providers/groq';
import { cerebrasProvider } from './providers/cerebras';
import type { AiJsonRequest, AiProvider } from './types';

const REGISTRY: Record<string, AiProvider> = {
  gemini: geminiProvider,
  groq: groqProvider,
  cerebras: cerebrasProvider,
};

/** Adds a provider under an extra name. Exists for scripts/ai-fallback-check.ts, which needs a
 *  deliberately stalling service to prove the hedge fires — the app itself only ever uses the
 *  built-in registry above. */
export function registerProvider(name: string, provider: AiProvider): void {
  REGISTRY[name.toLowerCase()] = provider;
}

// Analysis and document reading lead with the better model; short interactive asks lead with
// the fastest one. Both fall back to the others, so neither order costs a feature.
//
// Cerebras is last in both. It exists so that one provider running out of free allowance can no
// longer take every AI feature down with it — which is what nearly happened when Google's quota
// ran out and Groq was left carrying the whole app alone. It reads no images, so the gateway
// skips it for invoice scans by itself (see its `supports`).
const DEFAULT_ORDER = 'gemini,groq,cerebras';
const DEFAULT_FAST_ORDER = 'groq,cerebras,gemini';

/** Keep the primary provider on a short leash so a slow provider does not make the user wait
 * before the already-configured fallback gets a chance. Attachments genuinely take longer to
 * read, so they receive a larger (but still bounded) budget.
 *
 * Measured, not guessed: the reasoning models this app leads with spend real time thinking
 * before emitting structured JSON — a reorder forecast over an 18-item shortlist took 15.9s,
 * i.e. it was being aborted by the old 14s budget and reported to the owner as "the AI service
 * could not be reached", with nothing wrong at either end. This is deliberately generous
 * because the hedge below means nobody actually waits it out: the fallback starts alongside
 * after a few seconds and usually answers first. The long budget only decides whether a lone
 * surviving provider is allowed to finish, which is exactly when we want it to. */
const timeoutMs = (request: AiJsonRequest): number => {
  const configured = Number(process.env.AI_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return request.attachments?.length ? 45_000 : 25_000;
};

/** How long to let the leading provider work alone before starting the next one *alongside* it
 *  rather than after it. Whoever finishes first wins and the loser is cancelled.
 *
 *  This is the difference between a provider being slow and a request being slow: without it, a
 *  Gemini call that stalls costs its full timeout before Groq is even asked. The delay is not
 *  zero because racing every request from the start would double the API calls — and the free
 *  tiers here are small — for no gain on the majority that answer promptly.
 *
 *  Set AI_HEDGE_MS / AI_FAST_HEDGE_MS to 0 to disable and fall back to plain sequential retry. */
const hedgeMs = (request: AiJsonRequest): number => {
  const fast = request.priority === 'speed';
  const configured = Number(process.env[fast ? 'AI_FAST_HEDGE_MS' : 'AI_HEDGE_MS']);
  const base = Number.isFinite(configured) && configured >= 0 ? configured : fast ? 2_000 : 4_000;
  return request.attachments?.length ? base * 2 : base;
};

function orderedProviders(request: AiJsonRequest): AiProvider[] {
  const configured =
    request.priority === 'speed'
      ? process.env.AI_FAST_ORDER || DEFAULT_FAST_ORDER
      : process.env.AI_PROVIDER_ORDER || DEFAULT_ORDER;

  return configured
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
    .map((name) => REGISTRY[name])
    .filter((provider): provider is AiProvider => Boolean(provider));
}

function friendlyMessage(kinds: AiFailureKind[]): string {
  if (kinds.length && kinds.every((kind) => kind === 'blocked')) {
    return 'The AI declined to work with this content. Try rephrasing it or entering the details manually.';
  }
  if (kinds.includes('quota')) {
    return 'Every AI service is at its usage limit right now — please try again in a few minutes.';
  }
  return 'The AI service could not be reached right now — please try again in a few minutes.';
}

type Winner<T> = { data: T; provider: string; model: string };
type Attempt = { provider: string; kind: AiFailureKind; message: string };

/** One in-flight call, with the means to abandon it the moment someone else wins. */
function launchAttempt<T>(provider: AiProvider, request: AiJsonRequest) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${provider.name} timed out`)), timeoutMs(request));
  let cancelled = false;

  const promise = (async (): Promise<Winner<T>> => {
    const result = await provider.generateJson(request, controller.signal);

    let data: unknown;
    try {
      data = JSON.parse(result.text);
    } catch {
      throw new AiProviderError('Response was not valid JSON.', 'empty', provider.name);
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new AiProviderError('Response was not a JSON object.', 'empty', provider.name);
    }

    return { data: data as T, provider: provider.name, model: result.model };
  })().finally(() => clearTimeout(timer));

  return {
    promise,
    cancel(): void {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    },
    get cancelled(): boolean {
      return cancelled;
    },
  };
}

/** Starts providers in order, staggered by the hedge delay, and resolves with the first valid
 *  answer. A provider that fails immediately promotes the next one rather than making it wait
 *  out the stagger, so a fast failure still costs nothing. */
function raceProviders<T>(
  providers: AiProvider[],
  request: AiJsonRequest,
  hedge: number,
  attempts: Attempt[]
): Promise<Winner<T>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let failures = 0;
    const launched = new Array<boolean>(providers.length).fill(false);
    const handles: ReturnType<typeof launchAttempt<T>>[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];

    const finish = (action: () => void): void => {
      settled = true;
      timers.forEach(clearTimeout);
      handles.forEach((handle) => handle.cancel());
      action();
    };

    const launch = (index: number): void => {
      if (settled || index >= providers.length || launched[index]) return;
      launched[index] = true;

      const provider = providers[index];
      const handle = launchAttempt<T>(provider, request);
      handles.push(handle);

      if (hedge > 0 && index + 1 < providers.length) {
        timers.push(
          setTimeout(() => {
            if (settled) return;
            console.warn(`[ai] ${provider.name} still working after ${hedge}ms — starting ${providers[index + 1].name} alongside it`);
            launch(index + 1);
          }, hedge)
        );
      }

      handle.promise.then(
        (winner) => {
          if (settled) return;
          markHealthy(winner.provider);
          finish(() => resolve(winner));
        },
        (error: unknown) => {
          // A call we abandoned because someone else already won is not a failure worth
          // recording, and must not put a healthy provider into cooldown.
          if (handle.cancelled) return;

          const kind = classifyError(error);
          attempts.push({ provider: provider.name, kind, message: error instanceof Error ? error.message : String(error) });
          markUnavailable(provider.name, cooldownMs(kind));
          console.error(`[ai] ${provider.name} failed (${kind}): ${error instanceof Error ? error.message : String(error)}`);

          if (settled) return;

          // A request we built wrong fails identically everywhere — surface it as-is instead of
          // spending the other providers proving the same thing.
          if (!shouldTryNextProvider(kind)) {
            finish(() => reject(error));
            return;
          }

          failures += 1;
          launch(index + 1);
          if (failures === providers.length) {
            finish(() => reject(new AiUnavailableError(friendlyMessage(attempts.map((a) => a.kind)), attempts)));
          }
        }
      );
    };

    launch(0);
  });
}

/** Ask for one schema-shaped JSON answer, racing the configured providers so that no single
 *  slow or failing service can hold up the request.
 *
 *  Routes call only this. Which provider answered, what failed on the way, and how a quota
 *  error differs from a bad request all stay in here — a route just gets its data or one
 *  plain-language error. */
export async function generateJson<T>(request: AiJsonRequest): Promise<{ data: T; provider: string; model: string }> {
  const eligible = orderedProviders(request).filter((provider) => provider.configured() && provider.supports(request));

  if (eligible.length === 0) {
    throw new AiUnavailableError(
      'No AI provider is configured for this feature. Add GEMINI_API_KEY (and optionally GROQ_API_KEY) to .env.local and restart.',
      []
    );
  }

  // Skip anything still cooling down from a recent failure — unless that would leave nothing to
  // try, in which case a wasted call beats refusing to work at all.
  const healthy = eligible.filter((provider) => isAvailable(provider.name));
  const candidates = healthy.length ? healthy : eligible;

  const attempts: Attempt[] = [];

  try {
    const winner = await raceProviders<T>(candidates, request, hedgeMs(request), attempts);
    if (attempts.length) {
      console.warn(`[ai] ${winner.provider} answered after ${attempts.map((a) => `${a.provider}:${a.kind}`).join(', ')}`);
    }
    return winner;
  } catch (error) {
    if (error instanceof AiUnavailableError) throw error;
    if (error instanceof AiProviderError && !shouldTryNextProvider(error.kind)) throw error;
    throw new AiUnavailableError(friendlyMessage(attempts.map((a) => a.kind)), attempts);
  }
}

/** Turns any failure from generateJson into the JSON error shape every AI route already returns,
 *  so the existing UI error handling keeps working unchanged. */
export function aiErrorResponse(error: unknown, fallback: string): Response {
  if (error instanceof AiUnavailableError) {
    // No attempts means nothing was even configured — a setup problem, not an outage.
    const status = error.attempts.length === 0 ? 501 : 503;
    return Response.json({ error: error.message }, { status });
  }
  if (error instanceof AiProviderError && error.kind === 'bad_request') {
    return Response.json({ error: error.message }, { status: 502 });
  }
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
