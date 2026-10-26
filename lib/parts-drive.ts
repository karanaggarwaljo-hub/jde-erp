/**
 * Every part's photo and details in the company's Google Drive, kept up to date:
 *
 *   JDE ERP - <company>/Parts catalogue/
 *     Parts list                      a Google Sheet: part number, name, brand, what it fits,
 *                                     prices, stock, location, HSN, and a link to its photo
 *     Photos/911-12400 - BKT main pin.jpg
 *
 * A photo goes to the Drive the moment it is added to a part (sendPartPhotoToDrive), and the
 * nightly job catches up anything missed, takes away photos of parts that lost theirs, and
 * rewrites the sheet when anything in it changed (syncPartsToDrive).
 *
 * Each photo carries private labels (lib/drive/google.ts FileLabels): which part it is, and a short
 * fingerprint of the picture's address, so a changed photo is replaced in place and an unchanged
 * one is never sent twice. Drive limits a label to 124 bytes, hence a fingerprint, not the address.
 *
 * Server-only.
 */

import { createHash } from 'node:crypto';
import { recordAudit, SYSTEM_ACTOR } from './audit-log';
import { binInDrive, driveName, driveOpenLink, listDriveFolder, putInDrive } from './drive';
import { GoogleError } from './drive/google';
import { listAllRows } from './db';
import { catalogPhotoIndex, photoOf, type CatalogPhotoRow } from './part-photos';

const CATALOGUE = ['Parts catalogue'];
const PHOTOS = ['Parts catalogue', 'Photos'];
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export type DrivePart = {
  id: string;
  part_number?: string | null;
  other_numbers?: readonly string[] | null;
  oem_number?: string | null;
  name?: string | null;
  brand?: string | null;
  category?: string | null;
  compatibility?: string | null;
  cost_price?: number | string | null;
  mrp?: number | string | null;
  sale_price?: number | string | null;
  current_stock?: number | string | null;
  min_stock?: number | string | null;
  location?: string | null;
  hsn_code?: string | null;
  image_url?: string | null;
};

const fingerprint = (value: string) => createHash('sha1').update(value).digest('hex').slice(0, 16);
const text = (value: unknown) => (value === null || value === undefined ? '' : String(value).trim());

/** "911-12400 - BKT main pin.jpg": what the photo is, readable in the Drive app. */
export function photoFileName(part: DrivePart, mimeType: string): string {
  return `${driveName([text(part.part_number), text(part.name)]) || part.id}.${EXTENSION[mimeType] ?? 'jpg'}`;
}

/** A code made only of digits ("000123", a 16-digit OEM number) would lose its leading zeros or turn
 *  into a rounded number when Google makes the CSV a Sheet; written as a formula it stays as typed. */
function asText(value: unknown): string {
  const raw = text(value);
  return /^\d+$/.test(raw) && (raw.startsWith('0') || raw.length > 11) ? `="${raw}"` : raw;
}

function csvCell(value: unknown): string {
  const raw = text(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

/** The Parts list sheet, as CSV: one row per part, sorted by part number, with a link to its photo
 *  in the Drive where there is one. */
export function partsCsv(parts: DrivePart[], photoLinks: Map<string, string>): string {
  const header = ['Part number', 'Other numbers', 'OEM number', 'Name', 'Brand', 'Category', 'Fits', 'Sale price', 'MRP', 'Cost price', 'Stock', 'Min stock', 'Location', 'HSN', 'Photo'];
  const rows = [...parts]
    .sort((a, b) => text(a.part_number).localeCompare(text(b.part_number)) || text(a.name).localeCompare(text(b.name)))
    .map((part) => [asText(part.part_number), (part.other_numbers ?? []).join(', '), asText(part.oem_number), part.name, part.brand, part.category, part.compatibility, part.sale_price, part.mrp, part.cost_price, part.current_stock, part.min_stock, part.location, asText(part.hsn_code), photoLinks.get(part.id) ?? '']);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

async function companyParts(companyId: string): Promise<{ parts: DrivePart[]; photos: Map<string, string> }> {
  const [products, catalog] = await Promise.all([listAllRows('products'), listAllRows('catalog_products')]);
  const parts = products.filter((row) => row.company_id === companyId) as unknown as DrivePart[];
  const index = catalogPhotoIndex(catalog.filter((row) => row.company_id === companyId) as CatalogPhotoRow[]);
  const photos = new Map<string, string>();
  for (const part of parts) {
    const photo = photoOf({ id: part.id, image_url: part.image_url ?? null }, index);
    if (photo) photos.set(part.id, photo.url);
  }
  return { parts, photos };
}

async function fetchPhoto(url: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  const mimeType = (response.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
  return { bytes: new Uint8Array(await response.arrayBuffer()), mimeType: EXTENSION[mimeType] ? mimeType : 'image/jpeg' };
}

/** Sends one part's current photo to the Drive (replacing the old one), or bins it there when the
 *  part has no photo any more. False with no Drive connected. */
export async function sendPartPhotoToDrive(companyId: string, productId: string): Promise<boolean> {
  const folder = await listDriveFolder(companyId, PHOTOS);
  if (!folder) return false;
  const { parts, photos } = await companyParts(companyId);
  const part = parts.find((entry) => entry.id === productId);
  const existing = folder.files.filter((file) => file.labels.productId === productId);
  const url = part ? photos.get(productId) : undefined;
  if (!part || !url) {
    for (const file of existing) await binInDrive(companyId, file.id);
    return true;
  }
  const key = fingerprint(url);
  if (existing.some((file) => file.labels.photo === key)) return true;
  const photo = await fetchPhoto(url);
  if (!photo) return false;
  await putInDrive(companyId, {
    folderPath: PHOTOS,
    name: photoFileName(part, photo.mimeType),
    mimeType: photo.mimeType,
    bytes: photo.bytes,
    existingFileId: existing[0]?.id ?? null,
    labels: { productId, photo: key },
    description: `Photo of ${text(part.name) || 'a part'}${part.part_number ? ` (${text(part.part_number)})` : ''}, kept by JDE ERP.`,
  });
  for (const extra of existing.slice(1)) await binInDrive(companyId, extra.id);
  return true;
}

export type PartsDriveResult = { photosSaved: number; photosRemoved: number; waiting: number; sheet: 'written' | 'unchanged' | 'skipped' };

/** Brings the Drive's parts catalogue up to date for one company, within `budgetMs`. Null with no
 *  Drive connected. */
export async function syncPartsToDrive(companyId: string, budgetMs: number): Promise<PartsDriveResult | null> {
  const started = Date.now();
  const folder = await listDriveFolder(companyId, PHOTOS);
  if (!folder) return null;
  const { parts, photos } = await companyParts(companyId);
  const result: PartsDriveResult = { photosSaved: 0, photosRemoved: 0, waiting: 0, sheet: 'skipped' };

  // Photos of parts that no longer have one, or no longer exist: to the Bin.
  const filesByPart = new Map<string, typeof folder.files>();
  for (const file of folder.files) {
    const productId = file.labels.productId;
    if (!productId || !photos.has(productId)) {
      await binInDrive(companyId, file.id);
      result.photosRemoved += 1;
      continue;
    }
    filesByPart.set(productId, [...(filesByPart.get(productId) ?? []), file]);
  }

  // New and changed photos.
  const links = new Map<string, string>();
  for (const part of parts) {
    const url = photos.get(part.id);
    if (!url) continue;
    const existing = filesByPart.get(part.id) ?? [];
    const current = existing.find((file) => file.labels.photo === fingerprint(url));
    if (current) {
      links.set(part.id, driveOpenLink(current.id));
      continue;
    }
    // Photos get most of the time; the sheet below always gets its turn, so the details are never
    // left stale behind a long queue of photos (the rest go tomorrow night).
    if (Date.now() - started > budgetMs * 0.7) {
      result.waiting += 1;
      continue;
    }
    try {
      const photo = await fetchPhoto(url);
      if (!photo) continue;
      const saved = await putInDrive(companyId, {
        folderPath: PHOTOS,
        name: photoFileName(part, photo.mimeType),
        mimeType: photo.mimeType,
        bytes: photo.bytes,
        existingFileId: existing[0]?.id ?? null,
        labels: { productId: part.id, photo: fingerprint(url) },
        description: `Photo of ${text(part.name) || 'a part'}${part.part_number ? ` (${text(part.part_number)})` : ''}, kept by JDE ERP.`,
      });
      if (saved) {
        links.set(part.id, driveOpenLink(saved.id));
        result.photosSaved += 1;
      }
      for (const extra of existing.slice(1)) await binInDrive(companyId, extra.id);
    } catch (error) {
      if (error instanceof GoogleError && error.needsReconnect) throw error;
      console.error('[parts-drive] photo failed for', part.id, error);
    }
  }

  // The Parts list sheet, rewritten only when something in it changed. A new sheet is made and the
  // old one binned, rather than editing it in place, so the sheet is never half-written.
  {
    const csv = partsCsv(parts, links);
    const key = fingerprint(csv);
    const catalogue = await listDriveFolder(companyId, CATALOGUE);
    const sheets = (catalogue?.files ?? []).filter((file) => file.labels.kind === 'parts-list');
    if (sheets.some((file) => file.labels.hash === key)) {
      result.sheet = 'unchanged';
    } else {
      const saved = await putInDrive(companyId, {
        folderPath: CATALOGUE,
        name: 'Parts list',
        mimeType: 'text/csv',
        saveAs: SHEET_MIME,
        bytes: new Uint8Array(Buffer.from(`﻿${csv}`, 'utf8')),
        labels: { kind: 'parts-list', hash: key },
        description: 'Every part in JDE ERP with its details and a link to its photo. Rewritten by the ERP whenever a part changes; edit parts in the ERP, not here.',
      });
      if (saved) {
        for (const old of sheets) await binInDrive(companyId, old.id);
        result.sheet = 'written';
      }
    }
  }

  if (result.photosSaved || result.photosRemoved || result.sheet === 'written') {
    await recordAudit({
      companyId, action: 'parts.drive', entity: 'products', entityId: null,
      summary: `Parts catalogue in Google Drive updated: ${result.photosSaved} photo(s) added or changed, ${result.photosRemoved} removed${result.sheet === 'written' ? ', parts list rewritten' : ''}`,
      details: result,
      actor: SYSTEM_ACTOR,
    });
  }
  return result;
}
