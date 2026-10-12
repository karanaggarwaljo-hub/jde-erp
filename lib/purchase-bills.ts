/**
 * Supplier bills — the photo or PDF a purchase was entered from — kept for good and openable from
 * any device. Before this, a bill uploaded on the Purchases page was read by the AI and thrown
 * away; the owner asked where it went, and the answer was nowhere.
 *
 * Server-only. A bill's life:
 *
 *   1. Uploaded (read by the AI, or attached to a purchase by hand): kept in the private
 *      jde-bill-inbox bucket, keyed by the file's own fingerprint, so the same file is kept once.
 *   2. Its purchase is recorded: the bill is attached to it.
 *   3. Sent to the company's Google Drive, named after the purchase, and the inbox copy removed.
 *      With no Drive connected it simply stays in the inbox and still opens from the ERP.
 *   4. A bill read by the AI but never recorded as a purchase is cleared after a week.
 *
 * Steps 3 and 4 also run every night, so a bill that could not reach Google the first time (no
 * internet, Google down, Drive disconnected) gets there later on its own.
 */

import { ALL_COMPANIES, recordAudit, SYSTEM_ACTOR } from './audit-log';
import { datedFolderPath, driveFileName, driveOpenLink, putInDrive, readFromDrive } from './drive';
import { GoogleError } from './drive/google';
import {
  deletePurchaseBillRow,
  findPurchaseByFileHash,
  getPurchaseBillByHash,
  getPurchaseBillForPurchase,
  getPurchaseForBill,
  insertPurchaseBillRow,
  linkPurchaseBillRow,
  listBillsAwaitingDrive,
  listPurchaseBillRows,
  listUnusedInboxBills,
  putInboxFile,
  readInboxFile,
  removeInboxFile,
  updatePurchaseBillRow,
  type PurchaseBillRow,
} from './db';

export const BILL_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
/** Matches the jde-bill-inbox bucket's own limit. */
export const MAX_BILL_BYTES = 5 * 1024 * 1024;
/** How long a bill read by the AI but never recorded as a purchase is kept. */
const UNUSED_BILL_DAYS = 7;

export function isBillMimeType(value: unknown): value is (typeof BILL_MIME_TYPES)[number] {
  return typeof value === 'string' && (BILL_MIME_TYPES as readonly string[]).includes(value);
}

export function billExtension(mimeType: string): string {
  return EXTENSIONS[mimeType] ?? 'bin';
}

/** A SHA-256 in hex, as the browser's hashFile() makes it. */
export function isFileHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export class BillError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'BillError';
  }
}

/** Keeps an uploaded bill file. With `purchaseId` it is attached to that purchase at once (a bill
 *  added by hand); without, it waits for the purchase being entered from it. Keeping the same
 *  file twice is a no-op. */
export async function keepBill(input: {
  companyId: string;
  fileHash: string;
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
  purchaseId?: string | null;
  by: string;
}): Promise<PurchaseBillRow> {
  if (input.bytes.byteLength > MAX_BILL_BYTES) throw new BillError('This file is over 5 MB. Take a photo of the bill instead, or save the PDF smaller.', 413);
  const existing = await getPurchaseBillByHash(input.companyId, input.fileHash);
  if (existing) {
    if (input.purchaseId && existing.purchase_id && existing.purchase_id !== input.purchaseId) {
      throw new BillError(`This exact file is already the bill of purchase ${existing.purchase_id}.`, 409);
    }
    if (input.purchaseId && !existing.purchase_id) {
      await linkPurchaseBillRow(input.companyId, input.fileHash, input.purchaseId);
      existing.purchase_id = input.purchaseId;
    }
    return existing;
  }
  const inboxPath = `${input.companyId}/${input.fileHash}.${billExtension(input.mimeType)}`;
  await putInboxFile(inboxPath, input.bytes, input.mimeType);
  return insertPurchaseBillRow({
    company_id: input.companyId,
    file_hash: input.fileHash,
    purchase_id: input.purchaseId ?? null,
    file_name: input.fileName.slice(0, 200),
    mime_type: input.mimeType,
    size_bytes: input.bytes.byteLength,
    inbox_path: inboxPath,
    uploaded_by: input.by,
  });
}

/** Attaches the bill a purchase was entered from, once the purchase is recorded. False when no
 *  such file was kept (a spreadsheet import, or an older scan). */
export async function attachBillToPurchase(companyId: string, fileHash: string, purchaseId: string): Promise<boolean> {
  return linkPurchaseBillRow(companyId, fileHash, purchaseId);
}

/** Sends one attached bill to the company's Google Drive and removes the inbox copy. Returns false
 *  when the company has no Drive connected (the bill stays in the inbox, which is fine). */
export async function sendBillToDrive(bill: PurchaseBillRow): Promise<boolean> {
  if (!bill.purchase_id || bill.drive_file_id || !bill.inbox_path) return Boolean(bill.drive_file_id);
  const bytes = await readInboxFile(bill.inbox_path);
  if (!bytes) {
    await updatePurchaseBillRow(bill.id, { last_error: 'The kept copy of this bill is missing.' });
    return false;
  }
  const purchase = await getPurchaseForBill(bill.company_id, bill.purchase_id);
  const saved = await putInDrive(bill.company_id, {
    folderPath: datedFolderPath('Supplier bills', purchase?.date),
    name: driveFileName([
      bill.purchase_id,
      purchase?.supplier,
      purchase?.supplier_invoice_no ? `Bill ${purchase.supplier_invoice_no}` : null,
      purchase?.date,
    ], billExtension(bill.mime_type)),
    mimeType: bill.mime_type,
    bytes,
    description: `Supplier bill of purchase ${bill.purchase_id}, kept by JDE ERP. Original file: ${bill.file_name || 'unnamed'}.`,
  });
  if (!saved) return false;
  await updatePurchaseBillRow(bill.id, {
    drive_file_id: saved.id,
    drive_link: saved.webViewLink || driveOpenLink(saved.id),
    drive_saved_at: new Date().toISOString(),
    inbox_path: null,
    last_error: null,
  });
  await removeInboxFile(bill.inbox_path).catch((error) => console.error('Could not remove the inbox copy of a bill now in Drive:', bill.inbox_path, error));
  await recordAudit({
    companyId: bill.company_id, action: 'bill.drive', entity: 'purchase_orders', entityId: bill.purchase_id,
    summary: `Saved the supplier bill of ${bill.purchase_id} to Google Drive`,
    details: { file: bill.file_name, size_bytes: bill.size_bytes },
    actor: SYSTEM_ACTOR,
  });
  return true;
}

/** Best-effort Drive push right after a bill is attached; the nightly job retries any failure. */
export async function sendBillToDriveQuietly(companyId: string, purchaseId: string): Promise<void> {
  try {
    const bill = await getPurchaseBillForPurchase(companyId, purchaseId);
    if (bill) await sendBillToDrive(bill);
  } catch (error) {
    console.error(`Saving the bill of ${purchaseId} to Google Drive failed; tonight's job will retry:`, error);
    const bill = await getPurchaseBillForPurchase(companyId, purchaseId).catch(() => null);
    if (bill) await updatePurchaseBillRow(bill.id, { last_error: error instanceof Error ? error.message.slice(0, 300) : 'Failed' }).catch(() => undefined);
  }
}

export type BillSummary = { inDrive: boolean; driveLink: string | null; fileName: string; sizeBytes: number; mimeType: string; uploadedAt: string };

/** Which purchases have a bill, for the Purchases list. */
export async function billsByPurchase(companyId: string): Promise<Record<string, BillSummary>> {
  const rows = await listPurchaseBillRows(companyId);
  const out: Record<string, BillSummary> = {};
  for (const row of rows) {
    if (!row.purchase_id) continue;
    out[row.purchase_id] = {
      inDrive: Boolean(row.drive_file_id),
      driveLink: row.drive_link,
      fileName: row.file_name,
      sizeBytes: row.size_bytes,
      mimeType: row.mime_type,
      uploadedAt: row.uploaded_at,
    };
  }
  return out;
}

export type OpenedBill = { bytes: Uint8Array; mimeType: string; fileName: string };

/** A purchase's bill file, from Google Drive or the inbox, wherever it is now. */
export async function openBill(companyId: string, purchaseId: string): Promise<OpenedBill> {
  const bill = await getPurchaseBillForPurchase(companyId, purchaseId);
  if (!bill) throw new BillError('No supplier bill is attached to this purchase.', 404);
  const fileName = driveFileName([purchaseId, 'supplier bill'], billExtension(bill.mime_type));

  if (bill.drive_file_id) {
    let found: Uint8Array | 'missing' | 'not-connected';
    try {
      found = await readFromDrive(companyId, bill.drive_file_id);
    } catch (error) {
      if (error instanceof GoogleError && error.needsReconnect) {
        throw new BillError('This bill is in Google Drive, but the ERP\'s access to that Drive has stopped working. Connect Google Drive again in Settings.', 503);
      }
      throw error;
    }
    if (found === 'missing') throw new BillError('This bill was deleted from Google Drive. Look in the Drive\'s Bin (kept 30 days) to bring it back.', 410);
    if (found === 'not-connected') throw new BillError('This bill is in Google Drive, which is no longer connected. Connect Google Drive again in Settings to open it, or open it straight from the Drive.', 409);
    return { bytes: found, mimeType: bill.mime_type, fileName };
  }
  if (bill.inbox_path) {
    const bytes = await readInboxFile(bill.inbox_path);
    if (bytes) return { bytes, mimeType: bill.mime_type, fileName };
  }
  throw new BillError('The file of this bill could not be found.', 404);
}

export type BillSyncResult = { sent: number; waiting: number; failed: number; cleared: number };

/** Sends every waiting bill of a company to its Drive, inside the time allowed. */
export async function syncBillsToDrive(companyId: string, budgetMs: number): Promise<BillSyncResult> {
  const started = Date.now();
  const result: BillSyncResult = { sent: 0, waiting: 0, failed: 0, cleared: 0 };
  const waiting = await listBillsAwaitingDrive(companyId);
  for (const [index, bill] of waiting.entries()) {
    if (Date.now() - started > budgetMs) {
      result.waiting += waiting.length - index;
      break;
    }
    try {
      if (await sendBillToDrive(bill)) result.sent += 1;
      else result.waiting += 1;
    } catch (error) {
      result.failed += 1;
      await updatePurchaseBillRow(bill.id, { last_error: error instanceof Error ? error.message.slice(0, 300) : 'Failed' }).catch(() => undefined);
      // A refused key fails every bill the same way; stop rather than repeat it.
      if (error instanceof GoogleError && error.needsReconnect) {
        result.waiting += waiting.length - index - 1;
        break;
      }
    }
  }
  return result;
}

/** Clears bills read by the AI a week ago or more that never became a purchase — abandoned
 *  scans, and scans of bills that were then entered by hand instead. */
export async function clearUnusedBills(): Promise<number> {
  const cutoff = new Date(Date.now() - UNUSED_BILL_DAYS * 86_400_000).toISOString();
  // Every unattached bill first gets one more chance to find its purchase: a purchase saved while
  // its scanned bill was still being kept would otherwise have missed it.
  const unattached = await listUnusedInboxBills(new Date().toISOString());
  let cleared = 0;
  for (const bill of unattached) {
    try {
      const purchaseId = await findPurchaseByFileHash(bill.company_id, bill.file_hash);
      if (purchaseId) {
        await linkPurchaseBillRow(bill.company_id, bill.file_hash, purchaseId);
        continue;
      }
      if (Date.parse(bill.uploaded_at) >= Date.parse(cutoff)) continue;
      if (bill.inbox_path) await removeInboxFile(bill.inbox_path);
      await deletePurchaseBillRow(bill.id);
      cleared += 1;
    } catch (error) {
      console.error('Could not attach or clear a scanned bill:', bill.id, error);
    }
  }
  if (cleared > 0) {
    await recordAudit({
      companyId: ALL_COMPANIES, action: 'bill.inbox_cleared', entity: 'purchase_bills',
      summary: `Cleared ${cleared} scanned bill${cleared === 1 ? '' : 's'} that were never recorded as a purchase (kept ${UNUSED_BILL_DAYS} days)`,
      actor: SYSTEM_ACTOR,
    });
  }
  return cleared;
}
