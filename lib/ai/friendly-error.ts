/** Gemini's SDK surfaces failures as a raw JSON blob in error.message — not something to show a
 *  non-technical user directly. These translate that blob into a plain sentence AND into the HTTP
 *  status that carries it back intact.
 *
 *  The status matters as much as the words. lib/parseJsonOrThrow.ts deliberately replaces the body
 *  of a 500 with one calm generic sentence, because a 500 means "an unexpected fault" and the raw
 *  detail behind one is rarely readable. Curated explanations are passed through only on 501-503.
 *  So a route that knew exactly what went wrong ("Google's AI is out of quota") and returned it as
 *  a 500 had that explanation thrown away and replaced with "The ERP ran into a problem" — sending
 *  the owner hunting for a bug in the ERP that was never there. */

export type AiFailureKind = 'quota' | 'auth' | 'unavailable' | 'refused' | 'unknown';

/** What the route was asking Google to do, so a message can name it instead of blaming
 *  "Google's AI" as a whole.
 *
 *  This distinction is not cosmetic. Measured directly against the live key on 2026-09-04: an
 *  ordinary text request answered 200 while, seconds apart, web-search grounding and image
 *  generation both answered 429. The general allowance had reset; these two had not. Saying
 *  "Google's AI has no free usage left on this account" in that state is simply untrue — the
 *  rest of the app's AI was working fine — and it sends the owner looking for a fault that
 *  isn't there. */
export type GeminiCapability = 'search' | 'image' | 'ai';

const CAPABILITY_NAMES: Record<GeminiCapability, string> = {
  search: 'Google’s web and image search',
  image: 'Google’s image generation',
  ai: 'Google’s AI',
};

/** These two capabilities have their own, much smaller free allowances than ordinary text, and
 *  no backup provider can stand in for them — nothing else here searches the web or draws a
 *  picture. So the message says which one ran out, and what actually restores it. */
const MESSAGES: Record<Exclude<AiFailureKind, 'unknown'>, string> = {
  quota:
    '{capability} has used up its free allowance. It has a much smaller free limit than ordinary AI ' +
    'requests — the rest of the app’s AI is unaffected and still working. Nothing else can do this job, ' +
    'so it returns when that allowance resets, or once billing is enabled on the Google AI account.',
  auth:
    'Google’s AI rejected the key this ERP is using. Check that GEMINI_API_KEY is set correctly and is still valid.',
  unavailable:
    'Google’s AI is temporarily unavailable or overloaded. Please try again in a few minutes.',
  refused:
    'Google’s AI declined to answer this request. Try rewording the part name, or pick the reference photo yourself.',
};

/** Reads whatever shape the SDK threw — a JSON blob in `message`, a `status` number, or a plain
 *  Error — and decides which of the situations above it is. */
export function classifyAiFailure(error: unknown): AiFailureKind {
  const raw = error instanceof Error ? error.message : String(error);
  const status = typeof (error as { status?: unknown })?.status === 'number'
    ? (error as { status: number }).status
    : undefined;

  if (status === 429 || /RESOURCE_EXHAUSTED|exceeded your current quota|\bquota\b|rate limit/i.test(raw)) return 'quota';
  if (status === 401 || status === 403 || /API_KEY_INVALID|PERMISSION_DENIED|api key not valid|unauthenticated/i.test(raw)) return 'auth';
  if (status === 503 || status === 502 || /UNAVAILABLE|overloaded|try again later/i.test(raw)) return 'unavailable';
  if (/SAFETY|blocked|PROHIBITED_CONTENT|declined/i.test(raw)) return 'refused';
  return 'unknown';
}

/** The plain sentence for a failure, or the fallback when it isn't one of the known situations. */
function wording(kind: Exclude<AiFailureKind, 'unknown'>, capability: GeminiCapability): string {
  return MESSAGES[kind].replace('{capability}', CAPABILITY_NAMES[capability]);
}

export function friendlyAiErrorMessage(error: unknown, fallback: string, capability: GeminiCapability = 'ai'): string {
  const kind = classifyAiFailure(error);
  if (kind !== 'unknown') return wording(kind, capability);
  return error instanceof Error ? error.message : fallback;
}

/** The status that lets the message above survive the trip to the browser.
 *  501 = this deployment is not set up for it; 502 = the service refused; 503 = it can't answer
 *  right now; 500 = a genuine, unexplained fault, where a generic sentence really is the honest
 *  thing to show. */
export function aiFailureStatus(kind: AiFailureKind): 500 | 501 | 502 | 503 {
  switch (kind) {
    case 'quota': return 503;
    case 'unavailable': return 503;
    case 'auth': return 501;
    case 'refused': return 502;
    default: return 500;
  }
}

/** One call for a route's catch block: the right words with the right status behind them. */
export function aiFailureResponse(error: unknown, fallback: string, capability: GeminiCapability = 'ai'): Response {
  const kind = classifyAiFailure(error);
  const message = kind === 'unknown'
    ? (error instanceof Error ? error.message : fallback)
    : wording(kind, capability);
  return Response.json({ error: message }, { status: aiFailureStatus(kind) });
}
