/**
 * Sealing for the two Google secrets the ERP keeps: the OAuth client secret and each company's
 * refresh token. A refresh token is a standing key to the files the ERP made in someone's Drive, so
 * it is never stored as written. AES-256-GCM, keyed from the server's Supabase service key — a copy
 * of the database alone (a backup, a leaked dump) does not open it.
 *
 * Server-only. If the service key is ever rotated, the sealed values stop opening; the Settings
 * screen then says Google Drive must be connected again, which is the right outcome.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function key(secret = process.env.SUPABASE_SERVICE_ROLE_KEY): Buffer {
  if (!secret) throw new Error('The server is missing SUPABASE_SERVICE_ROLE_KEY, so it cannot keep Google Drive keys safely.');
  // Domain-separated, so this key is useless for anything except these values.
  return createHash('sha256').update('jde-erp/google-drive/v1\0').update(secret).digest();
}

/** `v1.<iv>.<tag>.<ciphertext>`, each base64url. */
export function seal(plain: string, secret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

/** The sealed value, or null when it does not open (a different key, or tampered with). */
export function unseal(sealed: string, secret?: string): string | null {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || body === undefined) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
