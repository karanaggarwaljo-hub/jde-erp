/**
 * Credit control: how much each customer may owe, whether a bill would take them past it, and a
 * payment reminder ready to send on WhatsApp. Pure.
 *
 * A credit limit of 0 or blank means no limit set — the default for every customer, so nothing
 * changes for anyone until the owner sets one.
 */

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const round2 = (value: number) => Math.round(value * 100) / 100;

export type CreditState = {
  limit: number | null;
  balance: number;
  /** Share of the limit in use, in percent. Null with no limit. */
  usedPercent: number | null;
  over: boolean;
  /** How far over the limit, or 0. */
  overBy: number;
  /** Room left under the limit, or 0. */
  room: number;
};

export function creditState(balance: number | string | null | undefined, limit: number | string | null | undefined): CreditState {
  const owed = round2(num(balance));
  const cap = num(limit) > 0 ? round2(num(limit)) : null;
  if (cap === null) return { limit: null, balance: owed, usedPercent: null, over: false, overBy: 0, room: 0 };
  return {
    limit: cap,
    balance: owed,
    usedPercent: round2((owed / cap) * 100),
    over: owed > cap,
    overBy: round2(Math.max(0, owed - cap)),
    room: round2(Math.max(0, cap - owed)),
  };
}

export type BillCreditCheck = CreditState & {
  /** What the customer will owe once this bill is saved. */
  after: number;
  /** True when this bill is what takes them over (or further over) the limit. */
  blocksQuietSave: boolean;
};

/** A bill about to be saved: `balance` is what the customer owes now; `oldBillDue` is what an
 *  edited bill already had on their account (0 for a new bill); `newBillDue` what it will leave. */
export function checkBillCredit(input: { balance: number | string; limit: number | string | null | undefined; oldBillDue: number; newBillDue: number }): BillCreditCheck {
  const after = round2(num(input.balance) - num(input.oldBillDue) + num(input.newBillDue));
  const state = creditState(after, input.limit);
  return { ...state, after, blocksQuietSave: state.over && num(input.newBillDue) > num(input.oldBillDue) };
}

/** An Indian mobile number in the form WhatsApp wants (91 + 10 digits), or null when the number on
 *  file cannot be one. */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D+/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `91${digits.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return digits;
  return null;
}

/** Opens WhatsApp (app or web) with the message typed in, ready to send — nothing is sent until
 *  the owner presses send there. */
export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  const number = whatsappNumber(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;
}

export type ReminderBill = { id: string; date: string; due: number };

/** A short, polite reminder listing the open bills. Plain text — WhatsApp shows *text* as bold. */
export function reminderText(input: { shopName: string; customerName: string; bills: ReminderBill[]; total: number; shopPhone?: string | null }): string {
  const rupees = (value: number) => `₹${round2(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const bills = [...input.bills].sort((a, b) => a.date.localeCompare(b.date));
  const lines = [
    `Namaste ${input.customerName.trim() || 'ji'},`,
    '',
    `This is a reminder from *${input.shopName.trim() || 'our shop'}* that *${rupees(input.total)}* is pending on your account.`,
  ];
  if (bills.length > 0) {
    lines.push('');
    for (const bill of bills.slice(0, 10)) lines.push(`• ${bill.id} of ${bill.date}: ${rupees(bill.due)}`);
    if (bills.length > 10) lines.push(`• and ${bills.length - 10} more`);
  }
  lines.push('', 'Kindly arrange the payment at your earliest convenience. Please ignore this if already paid.', '', 'Thank you,', input.shopName.trim() || '');
  if (input.shopPhone?.trim()) lines.push(input.shopPhone.trim());
  return lines.join('\n').trim();
}
