'use client';

/**
 * "Which bill?" — the list a return or a cancellation starts from when it is begun from a button
 * rather than from a bill's own row.
 *
 * Taking goods back used to mean finding the bill in the list first, then its "⋯" menu, then
 * Return goods. From Home or the top of Sales there is now one button, and this is what it opens:
 * type the bill number, the customer, or a part that was on it, and press the bill.
 */

import { useState } from 'react';
import { Search } from 'lucide-react';
import { invoiceBalanceDue } from '@/lib/invoice-balance';
import { searchBills } from '@/lib/bill-fix';
import { money } from '@/lib/money';
import { DRAFT_STATUS, type Invoice, type InvoiceItem } from '@/lib/sales-types';

/** How many bills are listed at once. Typing narrows the list; the newest are shown first. */
const SHOWN = 30;

export default function BillPickerModal({ invoices, invoiceItems, onPick, onClose }: {
  invoices: Invoice[];
  invoiceItems: InvoiceItem[];
  onPick: (invoice: Invoice) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const partsOn = (invoiceId: string) => invoiceItems.filter((item) => item.invoice_id === invoiceId).map((item) => `${item.part_number} ${item.name}`).join(' ');
  const found = searchBills(invoices, partsOn, query);
  const shown = found.slice(0, SHOWN);

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '600px' }} role="dialog" aria-modal="true" aria-labelledby="bill-picker-title">
        <div className="modal-header">
          <div>
            <h3 id="bill-picker-title" className="modal-title">Return or cancel a bill</h3>
            <p className="text-muted text-sm" style={{ marginTop: '3px' }}>Which bill is it? Press it to go on.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body flex flex-col gap-3">
          <div className="search-bar">
            <Search className="search-bar-icon" size={16} />
            <input type="text" autoFocus aria-label="Find a bill" placeholder="Bill number, customer, or a part on the bill" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className="bill-pick-list">
            {shown.map((invoice) => {
              const lines = invoiceItems.filter((item) => item.invoice_id === invoice.id);
              const due = invoiceBalanceDue(invoice);
              return (
                <button key={invoice.id} type="button" className="bill-pick" onClick={() => onPick(invoice)}>
                  <span className="bill-pick-main">
                    <span className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                      <span className="pn-chip">{invoice.id}</span>
                      <strong>{invoice.customer}</strong>
                      {invoice.status === DRAFT_STATUS && <span className="badge badge-muted">Draft</span>}
                    </span>
                    <small>
                      {invoice.date}
                      {lines.length > 0 && ` · ${lines[0].name}${lines.length > 1 ? ` and ${lines.length - 1} more` : ''}`}
                    </small>
                  </span>
                  <span className="bill-pick-money">
                    <strong>₹{money(Number(invoice.total))}</strong>
                    {invoice.status !== DRAFT_STATUS && <small className={due > 0 ? 'text-warning' : 'text-success'}>{due > 0 ? `₹${money(due)} to pay` : 'paid'}</small>}
                  </span>
                </button>
              );
            })}
            {shown.length === 0 && (
              <div className="empty-state" style={{ padding: '24px 16px' }}>
                <p className="empty-state-title">{invoices.length === 0 ? 'No bills yet' : 'No bill matches that'}</p>
                <p className="empty-state-desc">{invoices.length === 0 ? 'Make a bill first.' : 'Try the customer’s name, or part of the bill number.'}</p>
              </div>
            )}
          </div>
          {found.length > shown.length && (
            <p className="text-muted text-sm">Showing the newest {shown.length} of {found.length}. Type above to find an older one.</p>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
