/**
 * The shapes behind "paid by cheque". Pure.
 *
 * Cash & Bank — drawer and bank balances, statements, drawer counts — was removed on 2026-10-19 at
 * the owner's request. What is left is what the cheque register needs: the choice a payment
 * screen sends, the owner's banks (jde_money_accounts, kind 'bank'), and the record behind a
 * cheque taken or paid inside a bill or a purchase (jde_money_entries), which a bounce undoes.
 */

/** Old expenses recorded a free-text mode; read the common ones as methods. */
export function methodFromText(text: string | null | undefined): 'cash' | 'upi' | 'card' | 'bank' | 'cheque' | null {
  const value = (text ?? '').trim().toLowerCase();
  if (!value) return null;
  if (value === 'cash' || value === 'upi' || value === 'card' || value === 'bank' || value === 'cheque') return value;
  if (value.includes('cheque') || value.includes('check')) return 'cheque';
  if (value.includes('upi') || value.includes('gpay') || value.includes('phonepe') || value.includes('paytm')) return 'upi';
  if (value.includes('card')) return 'card';
  if (value.includes('neft') || value.includes('rtgs') || value.includes('imps') || value.includes('bank')) return 'bank';
  if (value.includes('cash')) return 'cash';
  return null;
}

/** What a screen sends with a payment. `method: 'cheque'` enters a cheque in the register; anything
 *  else records nothing. `accountId` is the owner's bank a cheque given is drawn on; `bankName` the
 *  bank a cheque received is drawn on. */
export type MoneyChoice = { method: 'cheque' | 'other'; accountId: string; chequeNo: string; chequeDate: string; bankName?: string };

/** One of the owner's banks (a row of jde_money_accounts). Older rows may be the retired cash
 *  drawer (kind 'cash'); those are never offered. */
export type MoneyAccount = {
  id: string;
  name: string;
  kind: 'cash' | 'bank';
  opening_balance: number | string;
  opening_date: string;
  archived: boolean;
};

export type MoneyEntryKind = 'sale_counter' | 'sale_refund' | 'purchase_paid' | 'purchase_payment' | 'transfer' | 'owner_in' | 'owner_out' | 'bank_charge' | 'adjustment' | 'drawer_count';

export type MoneyEntryRow = {
  id: string; date: string; kind: MoneyEntryKind; account_id: string | null; to_account_id: string | null; amount: number | string;
  method: string | null; source_type: string | null; source_id: string | null; party: string | null; note: string | null;
  cheque_no?: string | null; cheque_date?: string | null; cheque_status?: string | null; cleared_on?: string | null;
};
