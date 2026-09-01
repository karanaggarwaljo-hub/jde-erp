'use client';

import { FormEvent, useMemo, useState } from 'react';
import { IndianRupee, Wand2 } from 'lucide-react';
import { useCompany } from './CompanyProvider';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { receiveCustomerPayment, writeOffInvoiceBalance } from '@/lib/client-sales';
import { invoiceBalanceDue, isInvoiceOpen } from '@/lib/invoice-balance';

type Customer = { id: string; company_id: string; name: string; phone: string; email: string; gstin: string; address: string; type: string; balance: number };
type Invoice = { id: string; company_id: string; customer: string; date: string; total: number; paid: number; status: string; settlement_write_off: number; };
type Payment = { id: string; company_id: string; customer_id: string; customer: string; date: string; amount: number; note: string; created_at: string };

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function money(value: number) {
  return Math.round(Number(value) || 0).toLocaleString('en-IN');
}

type Props = {
  /** Pre-selects a customer (e.g. opened from that customer's row/ledger). Still changeable — a
   *  payment for the wrong customer is easy to fix here rather than closing and reopening. */
  customerId?: string;
  onClose: () => void;
  /** Called after the payment is actually saved — the caller decides what to show/where to go. */
  onRecorded: (result: { paymentId: string; customerName: string; appliedTotal: number }) => void;
};

/**
 * Records one payment and applies it across whichever of that customer's open invoices the
 * owner chooses — for a customer who bought across several days on credit and pays the running
 * total in one visit. Every rupee entered has to be assigned to a specific invoice (the "Fill
 * oldest first" button gives a starting point, oldest invoice first, that stays fully editable)
 * — nothing is left as an unexplained credit. See lib/db/index.ts (receiveCustomerPayment) and
 * scripts/customer-payments.sql for why: this is the single place, shared by the Sales page and
 * the Customers page, that talks to the atomic jde_receive_customer_payment RPC. Writing to
 * invoices/customer-balance directly from a page (as this app used to, on the Customers page)
 * left no record that a payment ever happened and could leave stock/balance/invoice status out
 * of step with each other if a step failed partway through.
 */
export default function ReceivePaymentModal({ customerId, onClose, onRecorded }: Props) {
  const { activeCompany } = useCompany();
  const { rows: customers } = useCompanyTable<Customer>('customers');
  const { rows: invoices, reload: reloadInvoices } = useCompanyTable<Invoice>('invoices');
  const { reload: reloadCustomers } = useCompanyTable<Customer>('customers');
  const { reload: reloadPayments } = useCompanyTable<Payment>('payments_received');

  const [selectedCustomerId, setSelectedCustomerId] = useState(customerId ?? '');
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  // Invoices the customer is settling by paying less than the balance: whatever is left after
  // this payment is forgiven rather than carried forward.
  const [settleShort, setSettleShort] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? null;

  const openInvoices = useMemo(() => {
    if (!selectedCustomer) return [];
    return invoices
      .filter((invoice) => invoice.customer === selectedCustomer.name && isInvoiceOpen(invoice))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }, [invoices, selectedCustomer]);

  const balanceOf = (invoice: Invoice) => invoiceBalanceDue(invoice);

  const changeCustomer = (id: string) => {
    setSelectedCustomerId(id);
    setAllocations({});
    setSettleShort({});
    setError('');
  };

  /** What would be forgiven on this invoice if it is marked settled: its balance less whatever
   *  of this payment is being applied to it. */
  const shortfallOn = (invoice: Invoice) =>
    Math.round((balanceOf(invoice) - (allocations[invoice.id] ?? 0)) * 100) / 100;

  const setAllocation = (invoiceId: string, value: number, cap: number) => {
    const clamped = Number.isFinite(value) ? Math.min(Math.max(value, 0), cap) : 0;
    setAllocations((current) => {
      if (clamped <= 0) {
        return Object.fromEntries(Object.entries(current).filter(([id]) => id !== invoiceId));
      }
      return { ...current, [invoiceId]: clamped };
    });
  };

  // A starting point, not a silent decision: distributes the entered amount across this
  // customer's open invoices oldest-first, up to each one's own balance. Every field it fills
  // stays a normal, editable input afterward — nothing is applied until Save is pressed.
  const fillOldestFirst = () => {
    let remaining = amount;
    const next: Record<string, number> = {};
    for (const invoice of openInvoices) {
      if (remaining <= 0) break;
      const due = balanceOf(invoice);
      const apply = Math.min(due, remaining);
      if (apply > 0) next[invoice.id] = Math.round(apply * 100) / 100;
      remaining -= apply;
    }
    setAllocations(next);
  };

  const settledShortInvoices = openInvoices.filter((invoice) => settleShort[invoice.id] && shortfallOn(invoice) > 0.01);
  const totalWriteOff = settledShortInvoices.reduce((sum, invoice) => sum + shortfallOn(invoice), 0);
  const totalAllocated = Object.values(allocations).reduce((sum, value) => sum + value, 0);
  const remainder = Math.round((amount - totalAllocated) * 100) / 100;
  const balanced = amount > 0 && Math.abs(remainder) <= 0.01 && Object.keys(allocations).length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeCompany || !selectedCustomer) return;
    if (!balanced) {
      setError(remainder > 0
        ? `₹${money(remainder)} of this payment hasn't been applied to an invoice yet.`
        : `₹${money(-remainder)} more has been applied than the payment amount — check the amounts entered.`);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const result = await receiveCustomerPayment({
        companyId: activeCompany.id,
        customerId: selectedCustomer.id,
        date,
        amount,
        note,
        allocations: Object.entries(allocations).map(([invoiceId, value]) => ({ invoiceId, amount: value })),
      });
      const failed: string[] = [];
      for (const invoice of settledShortInvoices) {
        try {
          await writeOffInvoiceBalance({
            companyId: activeCompany.id,
            invoiceId: invoice.id,
            amount: shortfallOn(invoice),
            reason: note.trim() ? `Settled short — ${note.trim()}` : 'Settled short',
            date,
          });
        } catch {
          failed.push(invoice.id);
        }
      }

      await Promise.all([reloadInvoices(), reloadCustomers(), reloadPayments()]);

      if (failed.length > 0) {
        // The payment itself is safely recorded; say plainly what still needs doing rather than
        // letting the owner believe those invoices are closed.
        setError(`Payment recorded, but ${failed.join(', ')} could not be settled short — use "Settle for less" on ${failed.length === 1 ? 'it' : 'them'} in Sales.`);
        setSaving(false);
        return;
      }

      onRecorded({ paymentId: result.payment_id, customerName: selectedCustomer.name, appliedTotal: result.applied_total });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This payment was not saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '640px' }} role="dialog" aria-modal="true" aria-labelledby="receive-payment-title">
        <form onSubmit={submit}>
          <div className="modal-header">
            <div>
              <h3 id="receive-payment-title" className="modal-title flex items-center gap-2"><IndianRupee size={16} /> Receive Payment</h3>
              <p className="text-muted text-sm">Apply it to one or more of this customer&apos;s open invoices.</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" aria-label="Close" disabled={saving} onClick={onClose}>✕</button>
          </div>

          <div className="modal-body flex flex-col gap-4">
            {error && <div className="alert alert-danger" role="alert">{error}</div>}

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Customer</label>
                <select required className="form-input form-select" disabled={saving} value={selectedCustomerId} onChange={(event) => changeCustomer(event.target.value)}>
                  <option value="">Select customer…</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}{Number(customer.balance) > 0 ? ` — ₹${money(customer.balance)} due` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Date</label>
                <input required type="date" className="form-input" disabled={saving} value={date} onChange={(event) => setDate(event.target.value)} />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Amount Received (₹)</label>
                <input required type="number" min="0.01" step="0.01" className="form-input" disabled={saving} value={amount || ''} onChange={(event) => setAmount(Number(event.target.value))} />
              </div>
              <div className="form-group">
                <label className="form-label">Note (optional)</label>
                <input type="text" className="form-input" placeholder="e.g. Cash, UPI, cheque #" disabled={saving} value={note} onChange={(event) => setNote(event.target.value)} />
              </div>
            </div>

            {selectedCustomer && (
              <div>
                <div className="flex justify-between items-center mb-2">
                  <strong style={{ fontSize: '13px' }}>Apply to invoices</strong>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={saving || amount <= 0 || openInvoices.length === 0} onClick={fillOldestFirst}>
                    <Wand2 size={13} /> Fill oldest first
                  </button>
                </div>

                {openInvoices.length === 0 ? (
                  <p className="text-muted text-sm">{selectedCustomer.name} has no open invoices to apply a payment to.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="erp-table">
                      <thead><tr><th>Invoice</th><th>Date</th><th className="text-right">Balance</th><th className="text-right" style={{ width: '140px' }}>Apply (₹)</th><th style={{ width: '150px' }}>Settle for less</th></tr></thead>
                      <tbody>
                        {openInvoices.map((invoice) => {
                          const due = balanceOf(invoice);
                          return (
                            <tr key={invoice.id}>
                              <td className="font-semibold">{invoice.id}</td>
                              <td>{invoice.date}</td>
                              <td className="text-right">₹{money(due)}</td>
                              <td className="text-right">
                                <input
                                  type="number" min="0" max={due} step="0.01" className="form-input text-right" disabled={saving}
                                  value={allocations[invoice.id] ?? ''}
                                  onChange={(event) => setAllocation(invoice.id, Number(event.target.value), due)}
                                />
                              </td>
                              <td>
                                {/* Only offered where something would actually be left over. */}
                                {shortfallOn(invoice) > 0.01 ? (
                                  <label className="flex items-center gap-2 text-sm" style={{ cursor: saving ? 'default' : 'pointer' }}>
                                    <input type="checkbox" disabled={saving} checked={Boolean(settleShort[invoice.id])}
                                      onChange={(event) => setSettleShort((current) => ({ ...current, [invoice.id]: event.target.checked }))} />
                                    <span>Write off ₹{money(shortfallOn(invoice))}</span>
                                  </label>
                                ) : <span className="text-muted text-sm">—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {amount > 0 && (
                  <p className={`text-sm ${balanced ? 'text-success' : 'text-muted'}`} style={{ marginTop: '8px' }}>
                    Applied ₹{money(totalAllocated)} of ₹{money(amount)}
                    {!balanced && remainder > 0 ? ` — ₹${money(remainder)} left to apply` : ''}
                  </p>
                )}

                {totalWriteOff > 0 && (
                  <p className="text-muted text-sm" style={{ marginTop: '4px' }}>
                    ₹{money(totalWriteOff)} on {settledShortInvoices.length === 1 ? '1 invoice' : `${settledShortInvoices.length} invoices`} will be
                    written off — {selectedCustomer.name} stops owing it, and it is recorded as forgiven, never as money received.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || !balanced}>{saving ? 'Saving…' : 'Record Payment'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
