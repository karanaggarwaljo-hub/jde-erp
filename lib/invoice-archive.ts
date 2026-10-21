/**
 * Every sales invoice, kept as a PDF in the ERP's own private storage — saved the moment the
 * invoice is, readable from any device signed in to the ERP, and small: one file per invoice,
 * replaced in place when the invoice changes, a few kilobytes each.
 *
 * Server-only. A stored PDF carries a fingerprint of the text it was drawn from, so it is redrawn
 * exactly when what it would print has changed — a payment, an edit, a write-off — and otherwise
 * served as saved. Three things keep the archive whole: saving an invoice saves its PDF, opening
 * a PDF brings it up to date first, and the nightly job catches anything the other two missed and
 * clears away the PDFs of deleted invoices.
 */

import { createHash } from 'node:crypto';
import { buildTallyInvoice, type TallyInvoice } from './tally-invoice';
import { renderTallyInvoicePdf } from './tally-invoice-pdf';
import {
  getInvoiceFileRecord,
  getInvoicePdfSource,
  listInvoicePdfSyncState,
  readInvoiceFile,
  removeInvoiceFile,
  saveInvoiceFile,
} from './db';

export type InvoicePdf = { bytes: Uint8Array | null; sizeBytes: number; savedAt: string; redrawn: boolean };

export function invoiceFingerprint(doc: TallyInvoice): string {
  return createHash('sha256').update(JSON.stringify(doc)).digest('hex').slice(0, 32);
}

/** The invoice's saved PDF, redrawn and saved again first if the invoice has changed since. Null
 *  when the invoice does not exist in this company. `needBytes: false` skips reading an unchanged
 *  file back, for callers that only want it to be saved. */
export async function ensureInvoicePdf(companyId: string, invoiceId: string, options: { needBytes?: boolean } = {}): Promise<InvoicePdf | null> {
  const needBytes = options.needBytes ?? true;
  const source = await getInvoicePdfSource(companyId, invoiceId);
  if (!source) return null;
  const doc = buildTallyInvoice(source);
  const fingerprint = invoiceFingerprint(doc);

  const record = await getInvoiceFileRecord(invoiceId);
  if (record && record.company_id === companyId && record.fingerprint === fingerprint) {
    if (!needBytes) return { bytes: null, sizeBytes: record.size_bytes, savedAt: record.saved_at, redrawn: false };
    const stored = await readInvoiceFile(record.path);
    if (stored) return { bytes: stored, sizeBytes: record.size_bytes, savedAt: record.saved_at, redrawn: false };
  }

  const bytes = await renderTallyInvoicePdf(doc);
  const saved = await saveInvoiceFile({ companyId, invoiceId, bytes, fingerprint });
  return { bytes, sizeBytes: saved.size_bytes, savedAt: saved.saved_at, redrawn: true };
}

/** Removes a deleted invoice's PDF. Best effort: the nightly job removes any it misses. */
export async function removeInvoicePdf(companyId: string, invoiceId: string): Promise<void> {
  await removeInvoiceFile(companyId, invoiceId);
}

export type InvoicePdfSyncResult = { saved: number; unchanged: number; removed: number; failed: number; remaining: number };

/** Brings every invoice's PDF up to date and removes the PDFs of invoices that no longer exist,
 *  stopping when `budgetMs` runs out so it always finishes inside the job's time limit — anything
 *  left is picked up the next night. */
export async function syncInvoicePdfs({ budgetMs = 25_000 }: { budgetMs?: number } = {}): Promise<InvoicePdfSyncResult> {
  const started = Date.now();
  const { invoices, orphans } = await listInvoicePdfSyncState();
  const result: InvoicePdfSyncResult = { saved: 0, unchanged: 0, removed: 0, failed: 0, remaining: 0 };

  for (const orphan of orphans) {
    try {
      await removeInvoiceFile(orphan.company_id, orphan.invoice_id);
      result.removed += 1;
    } catch (error) {
      console.error('[invoice-pdfs] could not remove the PDF of a deleted invoice:', orphan.invoice_id, error);
      result.failed += 1;
    }
  }

  for (let index = 0; index < invoices.length; index += 1) {
    if (Date.now() - started > budgetMs) {
      result.remaining = invoices.length - index;
      break;
    }
    const invoice = invoices[index];
    try {
      const pdf = await ensureInvoicePdf(invoice.company_id, invoice.id, { needBytes: false });
      if (pdf?.redrawn) result.saved += 1;
      else result.unchanged += 1;
    } catch (error) {
      console.error('[invoice-pdfs] could not save the PDF of', invoice.id, error);
      result.failed += 1;
    }
  }
  return result;
}
