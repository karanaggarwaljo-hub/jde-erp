import { AiProviderError, AiUnavailableError, classifyError, cooldownMs, shouldTryNextProvider, type AiFailureKind } from './errors';
import { isAvailable, markHealthy, markUnavailable } from './health';
import { geminiProvider } from './providers/gemini';
import { groqProvider } from './providers/groq';
import type { AiJsonRequest, AiProvider } from './types';

const REGISTRY: Record<string, AiProvider> = {
  gemini: geminiProvider,
  groq: groqProvider,
};

const DEFAULT_ORDER = 'gemini,groq';

/** A single AI call shouldn't hold a request open indefinitely — Vercel would kill the whole
 *  function first and the user would never reach the fallback. Documents take longer to read
 *  than a paragraph of text, so they get a longer leash. */
const timeoutMs = (request: AiJsonRequest): number => {
  const configured = Number(process.env.AI_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return request.attachments?.length ? 45_000 : 25_000;
};

function orderedProviders(): AiProvider[] {
  return (process.env.AI_PROVIDER_ORDER || DEFAULT_ORDER)
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

/** Ask for one schema-shaped JSON answer, trying each configured provider in turn.
 *
 *  Routes call only this. Which provider answered, what failed on the way, and how a quota
 *  error differs from a bad request all stay in here — a route just gets its data or one
 *  plain-language error. */
export async function generateJson<T>(request: AiJsonRequest): Promise<{ data: T; provider: string; model: string }> {
  const eligible = orderedProviders().filter((provider) => provider.configured() && provider.supports(request));

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

  const attempts: { provider: string; kind: AiFailureKind; message: string }[] = [];

  for (const provider of candidates) {
    // "Transient" means exactly what it says — a brief spike or a dropped connection — so each
    // provider gets one second chance before we give up on it. Any other kind of failure will
    // repeat identically, and retrying it only makes the user wait longer.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await provider.generateJson(request, AbortSignal.timeout(timeoutMs(request)));

        let data: unknown;
        try {
          data = JSON.parse(result.text);
        } catch {
          throw new AiProviderError('Response was not valid JSON.', 'empty', provider.name);
        }
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
          throw new AiProviderError('Response was not a JSON object.', 'empty', provider.name);
        }

        markHealthy(provider.name);
        if (attempts.length) {
          console.warn(`[ai] ${provider.name} answered after ${attempts.map((a) => `${a.provider}:${a.kind}`).join(', ')}`);
        }
        return { data: data as T, provider: provider.name, model: result.model };
      } catch (error) {
        const kind = classifyError(error);
        const message = error instanceof Error ? error.message : String(error);
        attempts.push({ provider: provider.name, kind, message });
        console.error(`[ai] ${provider.name} failed (${kind}): ${message}`);

        if (kind === 'transient' && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          continue;
        }

        markUnavailable(provider.name, cooldownMs(kind));
        break;
      }
    }

    // A request we built wrong fails identically everywhere — surface it instead of masking it.
    if (attempts.length && !shouldTryNextProvider(attempts[attempts.length - 1].kind)) break;
  }

  throw new AiUnavailableError(friendlyMessage(attempts.map((a) => a.kind)), attempts);
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
