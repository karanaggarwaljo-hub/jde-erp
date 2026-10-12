/**
 * Copies each sales invoice's PDF into the company's Google Drive, next to the supplier bills, so
 * every bill the shop issues is in the owner's Drive too. The ERP's own small copy
 * (lib/invoice-archive.ts) stays: it is what opens fastest from the ERP and what a redraw is
 * checked against. The Drive copy follows it — replaced in place when the invoice changes (a
 * payment, an edit), moved to the Drive's Bin when the invoice is deleted.
 *
 * Server-only. Separate from invoice-archive.ts so that module stays free of the request-bound
 * audit log, and its tests stay plain.
 */

import { recordAudit, SYSTEM_ACTOR } from './audit-log';
import { binInDrive, datedFolderPath, driveFileName, putInDrive } from './drive';
import { GoogleError } from './drive/google';
import { ensureInvoicePdf } from './invoice-archive';
import {
  getInvoiceFileRecord,
  getInvoicePdfSource,
  listDriveConnectionRows,
  listInvoiceFilesBehindDrive,
  readInvoiceFile,
  updateInvoiceFileDrive,
} from './db';

/** Puts the invoice's current PDF in the company's Drive if the Drive's copy is older or missing.
 *  False when no Drive is connected. */
export async function sendInvoicePdfToDrive(companyId: string, invoiceId: string): Promise<boolean> {
  const record = await getInvoiceFileRecord(invoiceId);
  if (!record || record.company_id !== companyId) return false;
  if (record.drive_file_id && record.drive_fingerprint === record.fingerprint) return true;

  const bytes = await readInvoiceFile(record.path);
  if (!bytes) return false;
  const source = await getInvoicePdfSource(companyId, invoiceId);
  if (!source) return false;

  const replacing = Boolean(record.drive_file_id);
  const saved = await putInDrive(companyId, {
    folderPath: datedFolderPath('Sales invoices', source.invoice.date),
    name: driveFileName([invoiceId, source.invoice.customer || 'Walk-in Customer', source.invoice.date], 'pdf'),
    mimeType: 'application/pdf',
    bytes,
    existingFileId: record.drive_file_id,
    description: `Sales invoice ${invoiceId}, kept by JDE ERP. Replaced automatically when the invoice changes.`,
  });
  if (!saved) return false;
  await updateInvoiceFileDrive(invoiceId, { drive_file_id: saved.id, drive_fingerprint: record.fingerprint, drive_saved_at: new Date().toISOString() });
  await recordAudit({
    companyId, action: 'invoice_pdf.drive', entity: 'invoices', entityId: invoiceId,
    summary: replacing ? `Updated the PDF of ${invoiceId} in Google Drive` : `Saved the PDF of ${invoiceId} to Google Drive`,
    details: { size_bytes: bytes.byteLength },
    actor: SYSTEM_ACTOR,
  });
  return true;
}

/** Right after a sale is saved: draw its PDF, then copy it to the Drive. Never throws — the
 *  sale is already saved, and tonight's job catches anything that failed here. */
export async function keepInvoicePdf(companyId: string, invoiceId: string): Promise<void> {
  try {
    await ensureInvoicePdf(companyId, invoiceId, { needBytes: false });
    await sendInvoicePdfToDrive(companyId, invoiceId);
  } catch (error) {
    console.error(`Keeping the PDF of ${invoiceId} failed; tonight's job will retry:`, error);
  }
}

/** A deleted invoice's PDF goes to the Drive's Bin (still recoverable for 30 days there). Best
 *  effort; must be called before the ERP's own record of the file is removed. */
export async function binInvoicePdfInDrive(companyId: string, invoiceId: string): Promise<void> {
  const record = await getInvoiceFileRecord(invoiceId);
  if (!record?.drive_file_id || record.company_id !== companyId) return;
  await binInDrive(companyId, record.drive_file_id);
  await recordAudit({
    companyId, action: 'invoice_pdf.drive', entity: 'invoices', entityId: invoiceId,
    summary: `Moved the PDF of deleted bill ${invoiceId} to the Google Drive Bin`,
    actor: SYSTEM_ACTOR,
  });
}

export type InvoiceDriveSyncResult = { sent: number; waiting: number; failed: number };

/** Copies every invoice PDF whose newest version is not in the Drive yet, for one company. */
export async function syncInvoicePdfsToDrive(companyId: string, budgetMs: number): Promise<InvoiceDriveSyncResult> {
  const started = Date.now();
  const result: InvoiceDriveSyncResult = { sent: 0, waiting: 0, failed: 0 };
  const behind = await listInvoiceFilesBehindDrive(companyId);
  for (const [index, record] of behind.entries()) {
    if (Date.now() - started > budgetMs) {
      result.waiting += behind.length - index;
      break;
    }
    try {
      if (await sendInvoicePdfToDrive(companyId, record.invoice_id)) result.sent += 1;
      else result.waiting += 1;
    } catch (error) {
      result.failed += 1;
      console.error('[invoice-drive] could not copy', record.invoice_id, error);
      if (error instanceof GoogleError && error.needsReconnect) {
        result.waiting += behind.length - index - 1;
        break;
      }
    }
  }
  return result;
}

/** Every company with a Drive connected. */
export async function connectedCompanyIds(): Promise<string[]> {
  return (await listDriveConnectionRows()).map((row) => row.company_id);
}
