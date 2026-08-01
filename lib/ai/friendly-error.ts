/** Gemini's SDK surfaces rate-limit/quota errors as a raw JSON blob in error.message — not
 *  something to show a non-technical user directly. Recognize that shape and translate it into
 *  a plain sentence; anything else falls through to its own message unchanged. */
export function friendlyAiErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/RESOURCE_EXHAUSTED|quota/i.test(raw)) {
    return 'The AI service has hit its usage limit for now — please try again in a few minutes.';
  }
  return error instanceof Error ? error.message : fallback;
}
