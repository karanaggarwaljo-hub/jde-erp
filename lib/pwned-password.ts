import { createHash } from 'node:crypto';

/**
 * Whether a password is on the public list of passwords leaked in other websites' data breaches —
 * the first ones anyone breaking in will try.
 *
 * Supabase offers this check only on its paid plan, and the owner has ruled out paid services, so
 * the ERP asks the same free list (Have I Been Pwned) itself. The password never leaves the
 * server: only the first five characters of its SHA-1 hash are sent, the list answers with every
 * leaked hash starting with them, and the match happens here. Padding is requested so the size of
 * the answer gives nothing away either.
 *
 * Answers null when the list cannot be reached, which the caller treats as "not known to be
 * leaked" — an outage on someone else's service must never stop the owner setting a password.
 */
export async function isLeakedPassword(password: string, fetchImpl: typeof fetch = fetch): Promise<boolean | null> {
  const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  try {
    const response = await fetchImpl(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    return appearsInRange(await response.text(), hash.slice(5));
  } catch {
    return null;
  }
}

/** Reads one answer from the list: a line per leaked hash, as SUFFIX:TIMES_SEEN. The padding lines
 *  added on request carry a count of 0 and are not real leaks. */
export function appearsInRange(rangeBody: string, suffix: string): boolean {
  const wanted = suffix.toUpperCase();
  return rangeBody.split('\n').some((line) => {
    const [candidate, seen] = line.trim().split(':');
    return candidate?.toUpperCase() === wanted && Number(seen) > 0;
  });
}
