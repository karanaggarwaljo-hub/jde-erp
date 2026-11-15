'use client';

/**
 * "Upload a stock or price list": the window that starts an upload.
 *
 * Uploading used to be a line in the More menu that opened a file picker straight away, with no
 * word on what kind of file would work. The easiest file to upload is the one this app writes, so
 * the window offers that first: download every part with its stock and prices, change the numbers
 * in Excel, and bring the same file back. A supplier's own price list, a photo or a PDF works too.
 *
 * Choosing a file only reads it. What it would change is shown next (StockSheetModal), and nothing
 * is saved until that is confirmed.
 */

import type { ChangeEvent } from 'react';
import { Download, Upload } from 'lucide-react';

export type UploadListModalProps = {
  partCount: number;
  /** True while a chosen file is being read. */
  reading: boolean;
  error: string;
  /** The `accept` list for the file picker: every spreadsheet format the reader handles, plus
   *  photos and PDFs. */
  accept: string;
  onFile: (file: File) => void;
  onDownload: () => void;
  onClose: () => void;
};

export default function UploadListModal({ partCount, reading, error, accept, onFile, onDownload, onClose }: UploadListModalProps) {
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared first, so choosing the same file twice in a row still counts as a choice.
    event.target.value = '';
    if (file) onFile(file);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '560px' }} role="dialog" aria-modal="true" aria-labelledby="upload-list-title">
        <div className="modal-header">
          <div>
            <h3 id="upload-list-title" className="modal-title">Upload a stock or price list</h3>
            <p className="text-muted text-sm" style={{ marginTop: '3px' }}>Updates the stock and prices of the parts you have, and adds any new ones.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Close" disabled={reading} onClick={onClose}>✕</button>
        </div>

        <div className="modal-body flex flex-col gap-4">
          {error && <div className="alert alert-danger" role="alert">{error}</div>}

          <div className="upload-step">
            <span className="upload-step-number" aria-hidden="true">1</span>
            <div>
              <strong>Get your list</strong>
              <p className="text-muted text-sm">
                Download {partCount > 0 ? `all ${partCount} of your parts` : 'your parts'} with their stock and prices. Open it in Excel, change the
                numbers, and save it. Leave a box as it is to keep that figure.
              </p>
              <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: '8px' }} disabled={partCount === 0} onClick={onDownload}>
                <Download size={14} /> Download my stock &amp; price list
              </button>
              <p className="text-muted text-sm" style={{ marginTop: '8px' }}>
                Already have a file, such as a supplier&apos;s price list? Skip this step.
              </p>
            </div>
          </div>

          <div className="upload-step">
            <span className="upload-step-number" aria-hidden="true">2</span>
            <div style={{ flex: 1 }}>
              <strong>Upload the file</strong>
              <label className={`upload-drop${reading ? ' is-busy' : ''}`}>
                <Upload size={22} aria-hidden="true" />
                <span>{reading ? 'Reading the file…' : 'Choose a file'}</span>
                <small>Excel or CSV, or a photo or PDF of a list. You can also drop it here.</small>
                <input type="file" accept={accept} hidden disabled={reading} onChange={choose} />
              </label>
            </div>
          </div>

          <p className="text-muted text-sm">
            You will see every change before anything is saved. A part is found by its part number, or by its name when
            the file has no numbers.
          </p>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" disabled={reading} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
