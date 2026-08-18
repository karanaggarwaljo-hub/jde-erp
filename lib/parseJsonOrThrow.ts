/** Reads a fetch Response defensively instead of calling res.json() directly, which blows up
 *  with an opaque "Unexpected end of JSON input" (empty body) or "Unexpected token... is not
 *  valid JSON" (a non-JSON body — an HTML error page or plain-text platform-level error, neither
 *  guaranteed on a failed response) — a raw parser exception a non-technical user can't read.
 *  Parses the body only if it's non-empty and valid, and always throws a real, readable Error on
 *  a non-2xx response: the server's own `error` field when present, otherwise a status-coded
 *  fallback. */
export async function parseJsonOrThrow(res: Response, fallback: string): Promise<unknown> {
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON body (e.g. an HTML error page) — fall through to the generic/status-based message.
    }
  }
  if (!res.ok) {
    const message = body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `${fallback} (${res.status})`;
    throw new Error(message);
  }
  return body;
}
