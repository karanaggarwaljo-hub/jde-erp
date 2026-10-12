/**
 * Each company's own Google Drive, as a place the ERP keeps files: supplier bills and the PDFs of
 * sales invoices. The owner asked for this so the files live in their 5 TB Drive, show up in the
 * Google Drive app on their phone, and cost the ERP's own storage nothing.
 *
 * Server-only. Layout in the Drive, all made by the ERP (so all visible to it under `drive.file`):
 *
 *   JDE ERP - <company name>/
 *     Supplier bills/2026/10 October/PO-1023 - Sharma Traders - Bill 4471 - 2026-10-12.jpg
 *     Sales invoices/2026/10 October/INV-1017 - Walk-in Customer - 2026-10-12.pdf
 */

import { seal, unseal } from './crypto';
import {
  buildAuthUrl,
  downloadFile,
  ensureFolder,
  GoogleError,
  isLive,
  refreshAccessToken,
  replaceFile,
  trashFile,
  uploadFile,
  type DriveFile,
  type OAuthClient,
} from './google';
import {
  getCompanyName,
  getDriveAppRow,
  getDriveConnectionRow,
  saveDriveAppRow,
  updateDriveConnectionRow,
  type DriveConnectionRow,
} from '../db';

export function redirectUriFor(origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/drive/callback`;
}

export async function getOAuthClient(): Promise<OAuthClient | null> {
  const row = await getDriveAppRow();
  if (!row) return null;
  const clientSecret = unseal(row.client_secret_enc);
  if (!clientSecret) return null;
  return { clientId: row.client_id, clientSecret };
}

export async function saveOAuthClient(clientId: string, clientSecret: string, by: string): Promise<void> {
  await saveDriveAppRow({ client_id: clientId.trim(), client_secret_enc: seal(clientSecret.trim()), updated_by: by });
}

export function authUrl(client: OAuthClient, origin: string, state: string): string {
  return buildAuthUrl(client, redirectUriFor(origin), state);
}

const tokenCache = new Map<string, { token: string; expiresAt: number; refreshTokenEnc: string }>();

export type DriveSession = { companyId: string; token: string; connection: DriveConnectionRow };

/** A working Google access token for this company's Drive, or null when no Drive is connected.
 *  Throws GoogleError when one is connected but Google refuses it (revoked, expired). */
export async function driveSession(companyId: string): Promise<DriveSession | null> {
  const connection = await getDriveConnectionRow(companyId);
  if (!connection) return null;
  const cached = tokenCache.get(companyId);
  if (cached && cached.expiresAt > Date.now() && cached.refreshTokenEnc === connection.refresh_token_enc) {
    return { companyId, token: cached.token, connection };
  }
  const client = await getOAuthClient();
  const refreshToken = unseal(connection.refresh_token_enc);
  if (!client || !refreshToken) {
    throw new GoogleError('The ERP can no longer open its Google key. Connect Google Drive again in Settings.', 401, 'invalid_grant');
  }
  const { accessToken, expiresAt } = await refreshAccessToken(client, refreshToken);
  tokenCache.set(companyId, { token: accessToken, expiresAt, refreshTokenEnc: connection.refresh_token_enc });
  return { companyId, token: accessToken, connection };
}

export function forgetDriveSession(companyId: string): void {
  tokenCache.delete(companyId);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** ["Supplier bills", "2026", "10 October"] for a date like 2026-10-12. Falls back to today. */
export function datedFolderPath(section: string, isoDate: string | null | undefined): string[] {
  const match = /^(\d{4})-(\d{2})/.exec(isoDate ?? '');
  const now = new Date();
  const year = match ? match[1] : String(now.getFullYear());
  const month = match ? Number(match[2]) : now.getMonth() + 1;
  return [section, year, `${String(month).padStart(2, '0')} ${MONTHS[month - 1] ?? ''}`.trim()];
}

/** A name Drive and every phone will show as written: no slashes, no control characters, not
 *  absurdly long. */
export function driveFileName(parts: Array<string | null | undefined>, extension: string): string {
  return `${driveName(parts) || 'file'}.${extension}`;
}

export function driveName(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' - ')
    .slice(0, 150);
}

/** The folder at `path` under the company's ERP folder, made where missing. Folder ids are
 *  remembered on the connection so a normal save asks Google for nothing but the upload. */
async function folderFor(session: DriveSession, path: string[]): Promise<string> {
  const { connection, token, companyId } = session;
  let rootId = connection.root_folder_id;
  if (!rootId) {
    const companyName = await getCompanyName(companyId);
    rootId = await ensureFolder(token, driveName(['JDE ERP', companyName]), null);
    connection.root_folder_id = rootId;
    await updateDriveConnectionRow(companyId, { root_folder_id: rootId });
  }
  if (path.length === 0) return rootId;
  const key = path.join('/');
  const known = connection.folders?.[key];
  if (known) return known;

  let parent = rootId;
  for (const name of path) parent = await ensureFolder(token, name, parent);
  connection.folders = { ...(connection.folders ?? {}), [key]: parent };
  await updateDriveConnectionRow(companyId, { folders: connection.folders });
  return parent;
}

/** Forgets remembered folder ids, after the owner moved or deleted one in the Drive. */
async function resetFolders(session: DriveSession): Promise<void> {
  const rootAlive = session.connection.root_folder_id ? await isLive(session.token, session.connection.root_folder_id).catch(() => false) : false;
  session.connection.folders = {};
  if (!rootAlive) session.connection.root_folder_id = null;
  await updateDriveConnectionRow(session.companyId, { folders: {}, root_folder_id: session.connection.root_folder_id });
}

export type DrivePut = {
  folderPath: string[];
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  /** Replace this file in place instead of adding a new one. */
  existingFileId?: string | null;
  description?: string;
};

/** Saves a file into the company's Drive. Null when no Drive is connected. Records the failure on
 *  the connection (for the Settings screen) and throws when Google refuses. */
export async function putInDrive(companyId: string, file: DrivePut): Promise<DriveFile | null> {
  let session: DriveSession | null;
  try {
    session = await driveSession(companyId);
  } catch (error) {
    await noteDriveError(companyId, error);
    throw error;
  }
  if (!session) return null;

  try {
    if (file.existingFileId) {
      try {
        const replaced = await replaceFile(session.token, file.existingFileId, file);
        await clearDriveError(session);
        return replaced;
      } catch (error) {
        // Deleted from the Drive since: save it afresh below rather than fail.
        if (!(error instanceof GoogleError && error.status === 404)) throw error;
      }
    }
    let parentId = await folderFor(session, file.folderPath);
    let saved: DriveFile;
    try {
      saved = await uploadFile(session.token, { name: file.name, parentId, mimeType: file.mimeType, bytes: file.bytes, description: file.description });
    } catch (error) {
      // A remembered folder that no longer exists answers 404: find or make the folders again.
      if (!(error instanceof GoogleError && error.status === 404)) throw error;
      await resetFolders(session);
      parentId = await folderFor(session, file.folderPath);
      saved = await uploadFile(session.token, { name: file.name, parentId, mimeType: file.mimeType, bytes: file.bytes, description: file.description });
    }
    await clearDriveError(session);
    return saved;
  } catch (error) {
    await noteDriveError(companyId, error);
    throw error;
  }
}

/** A file's bytes from the company's Drive. `missing` when it was deleted there; `not-connected`
 *  when the company has no Drive connected any more. */
export async function readFromDrive(companyId: string, fileId: string): Promise<Uint8Array | 'missing' | 'not-connected'> {
  const session = await driveSession(companyId);
  if (!session) return 'not-connected';
  const bytes = await downloadFile(session.token, fileId);
  return bytes ?? 'missing';
}

async function noteDriveError(companyId: string, error: unknown): Promise<void> {
  if (error instanceof GoogleError && error.needsReconnect) forgetDriveSession(companyId);
  const message = error instanceof Error ? error.message : String(error);
  await updateDriveConnectionRow(companyId, { last_error: message.slice(0, 500), last_error_at: new Date().toISOString() }).catch(() => undefined);
}

async function clearDriveError(session: DriveSession): Promise<void> {
  if (!session.connection.last_error) return;
  session.connection.last_error = null;
  await updateDriveConnectionRow(session.companyId, { last_error: null, last_error_at: null }).catch(() => undefined);
}

/** A link that opens the file in Google Drive, for someone signed in to that Google account. */
export function driveOpenLink(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

export function driveFolderLink(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}

/** Moves a file the ERP saved to the Drive's Bin. Quietly does nothing with no Drive connected. */
export async function binInDrive(companyId: string, fileId: string): Promise<void> {
  const session = await driveSession(companyId);
  if (session) await trashFile(session.token, fileId);
}

/** The company's "JDE ERP - <name>" folder, made now if needed — which also proves the connection
 *  works end to end. Null with no Drive connected. */
export async function driveRootFolder(companyId: string): Promise<string | null> {
  const session = await driveSession(companyId);
  if (!session) return null;
  await folderFor(session, []);
  return session.connection.root_folder_id;
}

/** Remembers, for the ten minutes the Google screen may take, which company is being connected and
 *  a random value Google must hand back unchanged — so the return trip cannot be forged from
 *  another site. Read and cleared by /api/drive/callback. */
export const DRIVE_STATE_COOKIE = 'jde_drive_oauth';
