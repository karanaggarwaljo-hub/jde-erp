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
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? ` Please try again in about ${Math.ceil(retryAfter)} second${retryAfter > 1 ? 's' : ''}.` : ' Please wait a moment and try again.';
      throw new Error(`The ERP is busy and did not save this action.${wait}`);
    }
    const serverMessage = body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
      ? (body as { error: string }).error
      : '';

    // 501/502/503 are not faults — they are this app's own routes deliberately reporting that a
    // service they depend on can't answer right now (not configured, at its usage limit, or
    // upstream refused), and the message they send is already written in plain English for the
    // owner. Replacing it with a generic sentence hid the one detail that explained the failure
    // and sent people hunting for a bug in the ERP that was never there.
    if (res.status >= 501 && res.status <= 503 && serverMessage) {
      console.warn(`Request to ${res.url} returned ${res.status}:`, serverMessage);
      throw new Error(serverMessage);
    }

    if (res.status >= 500) {
      // A genuine, unexpected fault. The user gets one calm sentence, but the server's own
      // explanation is worth keeping: a real fault reaching here used to leave no trace anywhere
      // the owner (or anyone helping them) could see, which is exactly how a broken database
      // function went unnoticed.
      //
      // Deliberately says nothing about whether anything was saved. This helper is used by
      // read-only screens as much as by saves, and telling someone asking for a summary that
      // "your action was not saved" invents an alarming event that never happened.
      console.error(`Request to ${res.url} failed with ${res.status}:`, serverMessage || text.slice(0, 300) || '(no response body)');
      throw new Error('The ERP ran into a problem and could not finish that — please try again in a moment.');
    }
    throw new Error(serverMessage || `${fallback} (${res.status})`);
  }
  return body;
}
