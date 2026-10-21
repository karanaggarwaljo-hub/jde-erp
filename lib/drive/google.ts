/**
 * The few Google calls the ERP makes, as plain HTTP — no Google SDK, which would add megabytes to
 * the server for five requests.
 *
 * Scope is `drive.file`: the ERP can see and change only the files and folders it created itself.
 * Nothing else in the owner's Drive — their photos, their other documents — is visible to it. It
 * is also a scope Google does not require an app review for, which is what lets the owner register
 * the ERP in a few minutes without waiting on Google.
 */

export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file', 'openid', 'email'];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export type OAuthClient = { clientId: string; clientSecret: string };

/** A Google answer that was not a success, with Google's own words kept for the Settings screen. */
export class GoogleError extends Error {
  constructor(message: string, readonly status: number, readonly reason: string) {
    super(message);
    this.name = 'GoogleError';
  }
  /** The refresh token no longer works: revoked from the Google account, or expired. Only
   *  connecting again fixes it, so the Settings screen says exactly that. */
  get needsReconnect(): boolean {
    return this.reason === 'invalid_grant' || this.reason === 'unauthorized_client' || this.status === 401;
  }
}

async function googleError(response: Response, what: string): Promise<GoogleError> {
  const text = await response.text().catch(() => '');
  let reason = '';
  let detail = '';
  try {
    const body = JSON.parse(text) as { error?: string | { message?: string; errors?: Array<{ reason?: string }> }; error_description?: string };
    if (typeof body.error === 'string') {
      reason = body.error;
      detail = body.error_description ?? body.error;
    } else if (body.error) {
      reason = body.error.errors?.[0]?.reason ?? '';
      detail = body.error.message ?? '';
    }
  } catch {
    detail = text.slice(0, 200);
  }
  return new GoogleError(`${what}: ${detail || response.statusText || response.status}`, response.status, reason);
}

export function buildAuthUrl(client: OAuthClient, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPES.join(' '),
    // offline + consent: Google hands back a refresh token every time, so connecting again after
    // a disconnect always works instead of silently returning no token.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; id_token?: string; scope?: string };

async function tokenRequest(body: Record<string, string>, what: string): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  if (!response.ok) throw await googleError(response, what);
  return (await response.json()) as TokenResponse;
}

/** The one-time code from Google's consent screen, traded for a refresh token and the address of
 *  the Google account that granted it. */
export async function exchangeCode(client: OAuthClient, code: string, redirectUri: string) {
  const tokens = await tokenRequest({
    code, client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code',
  }, 'Google did not accept the sign-in');
  if (!tokens.refresh_token) {
    throw new GoogleError('Google did not hand back a lasting key. Remove "JDE ERP" from your Google account\'s third-party access and connect again.', 400, 'no_refresh_token');
  }
  const granted = (tokens.scope ?? '').split(' ');
  if (!granted.includes(DRIVE_SCOPES[0])) {
    throw new GoogleError('Google Drive access was not ticked on the Google screen. Connect again and allow "See, edit, create and delete only the specific Google Drive files you use with this app".', 400, 'scope_missing');
  }
  return { refreshToken: tokens.refresh_token, accessToken: tokens.access_token, email: emailFromIdToken(tokens.id_token) };
}

/** The `email` claim of a Google id token. It came straight from Google over TLS in the same
 *  response, so reading it without checking the signature is what Google's own docs allow. */
export function emailFromIdToken(idToken: string | undefined): string {
  const payload = idToken?.split('.')[1];
  if (!payload) return '';
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: unknown };
    return typeof claims.email === 'string' ? claims.email : '';
  } catch {
    return '';
  }
}

export async function refreshAccessToken(client: OAuthClient, refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const tokens = await tokenRequest({
    refresh_token: refreshToken, client_id: client.clientId, client_secret: client.clientSecret, grant_type: 'refresh_token',
  }, 'Google Drive refused the ERP\'s key');
  return { accessToken: tokens.access_token, expiresAt: Date.now() + Math.max(60, tokens.expires_in - 120) * 1000 };
}

/** Best effort: the key stops working on Google's side too, not only in the ERP. */
export async function revokeToken(token: string): Promise<void> {
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
  }).catch(() => undefined);
}

function auth(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Drive's query language quotes with single quotes and escapes with backslashes. */
export function driveQuoted(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** The id of the folder called `name` inside `parentId` (or the Drive's top level), made if it is
 *  not there. Only folders the ERP itself made are visible to it, so a folder of the same name the
 *  owner made by hand is never mistaken for its own. */
export async function ensureFolder(accessToken: string, name: string, parentId: string | null): Promise<string> {
  const q = [
    `name = ${driveQuoted(name)}`,
    `mimeType = '${FOLDER_MIME}'`,
    'trashed = false',
    parentId ? `${driveQuoted(parentId)} in parents` : `'root' in parents`,
  ].join(' and ');
  const search = await fetch(`${FILES_URL}?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1', spaces: 'drive' })}`, { headers: auth(accessToken) });
  if (!search.ok) throw await googleError(search, 'Could not look for a folder in Google Drive');
  const found = ((await search.json()) as { files?: Array<{ id: string }> }).files?.[0];
  if (found) return found.id;

  const created = await fetch(`${FILES_URL}?fields=id`, {
    method: 'POST',
    headers: { ...auth(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined }),
  });
  if (!created.ok) throw await googleError(created, 'Could not make a folder in Google Drive');
  return ((await created.json()) as { id: string }).id;
}

/** Whether a folder or file the ERP remembers is still there and not in the Bin. */
export async function isLive(accessToken: string, fileId: string): Promise<boolean> {
  const response = await fetch(`${FILES_URL}/${encodeURIComponent(fileId)}?fields=id,trashed`, { headers: auth(accessToken) });
  if (response.status === 404) return false;
  if (!response.ok) throw await googleError(response, 'Could not check a file in Google Drive');
  return !((await response.json()) as { trashed?: boolean }).trashed;
}

/** A `multipart/related` body: the file's details, then its bytes — one request instead of two. */
export function multipartBody(metadata: Record<string, unknown>, mimeType: string, bytes: Uint8Array, boundary: string): Uint8Array {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return new Uint8Array(Buffer.concat([head, Buffer.from(bytes), tail]));
}

export type DriveFile = { id: string; webViewLink: string };

/** Labels the ERP puts on a file it saves (Drive "appProperties", private to the ERP), so it can
 *  tell later which part a photo belongs to without keeping its own list. */
export type FileLabels = Record<string, string>;

/** Saves a new file into a folder. `saveAs` turns it into a Google file on the way in (a CSV
 *  saved as a Google Sheet). */
export async function uploadFile(accessToken: string, input: { name: string; parentId: string; mimeType: string; bytes: Uint8Array; description?: string; labels?: FileLabels; saveAs?: string }): Promise<DriveFile> {
  const boundary = `jde-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const metadata: Record<string, unknown> = { name: input.name, parents: [input.parentId], description: input.description };
  if (input.labels) metadata.appProperties = input.labels;
  if (input.saveAs) metadata.mimeType = input.saveAs;
  const body = multipartBody(metadata, input.mimeType, input.bytes, boundary);
  const response = await fetch(`${UPLOAD_URL}?uploadType=multipart&fields=id,webViewLink`, {
    method: 'POST',
    headers: { ...auth(accessToken), 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: Buffer.from(body),
  });
  if (!response.ok) throw await googleError(response, 'Could not save the file to Google Drive');
  return (await response.json()) as DriveFile;
}

/** Replaces a file's contents (and name) in place, so it keeps its place and link in the Drive and
 *  no second copy appears. */
export async function replaceFile(accessToken: string, fileId: string, input: { name: string; mimeType: string; bytes: Uint8Array; labels?: FileLabels }): Promise<DriveFile> {
  const boundary = `jde-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const body = multipartBody(input.labels ? { name: input.name, appProperties: input.labels } : { name: input.name }, input.mimeType, input.bytes, boundary);
  const response = await fetch(`${UPLOAD_URL}/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,webViewLink`, {
    method: 'PATCH',
    headers: { ...auth(accessToken), 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: Buffer.from(body),
  });
  if (!response.ok) throw await googleError(response, 'Could not update the file in Google Drive');
  return (await response.json()) as DriveFile;
}

export type DriveListed = { id: string; name: string; mimeType: string; labels: FileLabels };

/** Every file the ERP saved directly inside a folder (not in the Bin), with its labels. */
export async function listFolder(accessToken: string, parentId: string): Promise<DriveListed[]> {
  const out: DriveListed[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: `${driveQuoted(parentId)} in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, appProperties)',
      pageSize: '1000',
      spaces: 'drive',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetch(`${FILES_URL}?${params}`, { headers: auth(accessToken) });
    if (!response.ok) throw await googleError(response, 'Could not list a folder in Google Drive');
    const page = (await response.json()) as { nextPageToken?: string; files?: Array<{ id: string; name: string; mimeType: string; appProperties?: FileLabels }> };
    for (const entry of page.files ?? []) out.push({ id: entry.id, name: entry.name, mimeType: entry.mimeType, labels: entry.appProperties ?? {} });
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

/** A file's bytes, or null when it is gone from the Drive (deleted, or emptied from the Bin). */
export async function downloadFile(accessToken: string, fileId: string): Promise<Uint8Array | null> {
  const response = await fetch(`${FILES_URL}/${encodeURIComponent(fileId)}?alt=media`, { headers: auth(accessToken) });
  if (response.status === 404) return null;
  if (!response.ok) throw await googleError(response, 'Could not open the file from Google Drive');
  return new Uint8Array(await response.arrayBuffer());
}

/** Moves a file to the Drive's Bin, where the owner can still bring it back for 30 days. Already
 *  gone counts as done. */
export async function trashFile(accessToken: string, fileId: string): Promise<void> {
  const response = await fetch(`${FILES_URL}/${encodeURIComponent(fileId)}`, {
    method: 'PATCH',
    headers: { ...auth(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
  if (response.status === 404) return;
  if (!response.ok) throw await googleError(response, 'Could not move the file to the Google Drive Bin');
}
