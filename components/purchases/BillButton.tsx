'use client';

import { ChangeEvent, useRef, useState } from 'react';
import { FileText, Paperclip } from 'lucide-react';
import { fileToBase64, hashFile } from '@/lib/client-import';
import { DOCUMENT_SCAN_DIMENSION, resizeImageForUpload } from '@/lib/imageResize';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';

export type PurchaseBillSummary = { inDrive: boolean; driveLink: string | null; fileName: string; sizeBytes: number; mimeType: string; uploadedAt: string };

/**
 * A purchase's supplier bill on the Purchases list: "Bill" opens it (from Google Drive or the ERP,
 * wherever it is now) on any device signed in to the ERP; "Attach bill" adds one to a purchase
 * that has none — a phone photo is shrunk first, the same way a scanned bill is.
 */
export default function BillButton({ companyId, purchaseId, bill, onAttached }: {
  companyId: string;
  purchaseId: string;
  bill: PurchaseBillSummary | undefined;
  onAttached: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (bill) {
    return (
      <button type="button" className="btn btn-ghost btn-sm" aria-label={`Supplier bill of ${purchaseId}`}
        title={bill.inDrive ? 'Open the supplier bill (kept in Google Drive)' : 'Open the supplier bill'}
        onClick={() => window.open(`/api/purchases/bill?companyId=${encodeURIComponent(companyId)}&purchaseId=${encodeURIComponent(purchaseId)}`, '_blank')}>
        <FileText size={14} /> Bill
      </button>
    );
  }

  const attach = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const fileHash = await hashFile(file);
      let base64: string;
      let mimeType: string;
      if (file.type === 'application/pdf') {
        if (file.size > 4_000_000) throw new Error('This PDF is over 4 MB. Take a photo of the bill instead.');
        base64 = await fileToBase64(file);
        mimeType = file.type;
      } else if (file.type.startsWith('image/')) {
        ({ base64, mimeType } = await resizeImageForUpload(file, { maxDimension: DOCUMENT_SCAN_DIMENSION }));
      } else {
        throw new Error('Attach a photo or a PDF of the bill.');
      }
      const res = await fetch('/api/purchases/bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, purchaseId, base64, mimeType, fileHash, fileName: file.name }),
      });
      await parseJsonOrThrow(res, 'The bill could not be attached.');
      onAttached(`Supplier bill attached to ${purchaseId}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The bill could not be attached.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} title="Attach a photo or PDF of the supplier's bill"
        aria-label={`Attach the supplier bill of ${purchaseId}`} onClick={() => input.current?.click()}>
        <Paperclip size={14} /> {busy ? 'Attaching…' : 'Attach bill'}
      </button>
      <input ref={input} type="file" accept="image/*,application/pdf" hidden onChange={attach} />
      {error && <span className="form-error" role="alert" style={{ fontSize: '11px', flexBasis: '100%' }}>{error}</span>}
    </>
  );
}
