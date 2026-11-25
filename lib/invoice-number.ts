/**
 * A bill number typed by hand (optional). Left blank, the database numbers the bill itself, as it
 * always has (INV-1025, INV-1026, ...). The owner asked for the choice in November 2026.
 *
 * GST Rule 46(b): an invoice number is at most 16 characters of letters, numbers, hyphen (-) and
 * slash (/), and unique. Invoice numbers here are unique across every company in the ERP (the
 * database key), so the database makes the final check; this one only answers early, on the bills
 * this screen has loaded. jde_save_sales_invoice applies the same rules.
 */
export const INVOICE_NUMBER_MAX = 16;

/** As it is saved: trimmed and in capitals. Blank means "number it for me". */
export function cleanInvoiceNumber(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase();
}

/** Why this typed number cannot be used, or null when it can (or is blank: automatic). */
export function invoiceNumberProblem(raw: unknown, takenIds: Iterable<string> = []): string | null {
  const number = cleanInvoiceNumber(raw);
  if (!number) return null;
  if (number.length > INVOICE_NUMBER_MAX) return `An invoice number can be at most ${INVOICE_NUMBER_MAX} characters.`;
  if (!/^[A-Z0-9/-]+$/.test(number)) return 'Use only letters, numbers, - and / in an invoice number (no spaces).';
  if (!/[0-9]/.test(number)) return 'An invoice number needs at least one number in it.';
  for (const id of takenIds) {
    if (String(id).toUpperCase() === number) return `${number} is already used by another bill. Type a different number, or leave it blank.`;
  }
  return null;
}
