/**
 * The Log Book's vocabulary: which kind of activity an entry is, what to call it, and how its time
 * reads. Pure, so the screen, the server's filters and the CSV download all agree.
 *
 * Every entry's `action` is `<subject>.<verb>` ('invoice.create', 'products.edit', 'auth.signin').
 * A kind is a set of subjects, which is also how the server filters: `action LIKE 'invoice.%'`.
 */

export type LogKind = 'sales' | 'purchases' | 'stock' | 'expenses' | 'files' | 'website' | 'access' | 'data';

export const LOG_KINDS: Array<{ key: LogKind; label: string; subjects: string[] }> = [
  { key: 'sales', label: 'Sales & customers', subjects: ['invoice', 'invoices', 'quotation', 'quotations', 'sales', 'sales_returns', 'payment', 'payments_received', 'invoice_writeoffs', 'customers'] },
  { key: 'purchases', label: 'Purchases & suppliers', subjects: ['purchase', 'purchase_orders', 'purchase_returns', 'supplier', 'supplier_payments', 'suppliers'] },
  { key: 'stock', label: 'Parts & stock', subjects: ['products', 'stock_layers', 'inventory'] },
  { key: 'expenses', label: 'Expenses', subjects: ['expense', 'expenses'] },
  { key: 'files', label: 'Bills, PDFs & Google Drive', subjects: ['bill', 'invoice_pdf', 'drive'] },
  { key: 'website', label: 'Website', subjects: ['catalog_products', 'catalog', 'catalog_leads'] },
  { key: 'access', label: 'Sign-ins & staff', subjects: ['auth', 'users'] },
  { key: 'data', label: 'Company & backups', subjects: ['company', 'companies', 'backup'] },
];

export function isLogKind(value: unknown): value is LogKind {
  return LOG_KINDS.some((kind) => kind.key === value);
}

export function kindOf(action: string): LogKind | null {
  const subject = action.split('.')[0];
  return LOG_KINDS.find((kind) => kind.subjects.includes(subject))?.key ?? null;
}

const SUBJECT_NAMES: Record<string, string> = {
  invoice: 'Bill', invoices: 'Bill', quotation: 'Quotation', quotations: 'Quotation', sales: 'Sale',
  sales_returns: 'Customer return', payment: 'Payment received', payments_received: 'Payment received',
  invoice_writeoffs: 'Write-off', customers: 'Customer', purchase: 'Purchase', purchase_orders: 'Purchase',
  purchase_returns: 'Return to supplier', supplier: 'Supplier', supplier_payments: 'Payment to supplier',
  suppliers: 'Supplier', products: 'Part', stock_layers: 'Stock', inventory: 'Inventory', expense: 'Expense',
  expenses: 'Expense', bill: 'Supplier bill', invoice_pdf: 'Bill PDF', drive: 'Google Drive',
  catalog_products: 'Website listing', catalog: 'Website', catalog_leads: 'Website enquiry', auth: 'Sign-in',
  users: 'Staff', company: 'Company', companies: 'Company', backup: 'Backup',
};

const VERB_NAMES: Record<string, string> = {
  create: 'added', edit: 'changed', delete: 'deleted', adjust: 'adjusted', receive: 'received', payment: 'paid',
  return: 'returned', writeOff: 'settled', merge: 'merged', import: 'imported', photo: 'photo', renumber: 'renumbered',
  start_fresh: 'started fresh', signin: 'signed in', signin_failed: 'wrong password', signout: 'signed out',
  invite: 'invited', invite_accepted: 'joined', password_reset: 'new password set', reset_requested: 'password reset asked', scan: 'read by AI',
  attach: 'attached', drive: 'saved to Drive', open: 'opened', connect: 'connected', disconnect: 'disconnected',
  setup: 'set up', sync: 'sync', storefront: 'website company', download: 'downloaded', auto: 'nightly backup',
  convert: 'turned into a bill', inbox_cleared: 'unused scans cleared', fitment: 'fitment',
};

/** "invoice.create" -> "Bill added". Unknown pairs fall back to the words themselves. */
export function actionLabel(action: string): string {
  const [subject = '', verb = ''] = action.split('.');
  const noun = SUBJECT_NAMES[subject] ?? subject.replace(/_/g, ' ');
  const what = VERB_NAMES[verb] ?? verb.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  const text = what ? `${noun} ${what}` : noun;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The shop is in India, and an entry made at 11:50 pm must not show under the next day on a phone
 *  set to another zone, so every time is shown in India time whatever the device says. */
export const SHOP_TIME_ZONE = 'Asia/Kolkata';

export function shopDay(at: string | Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}

export function shopTime(at: string | Date): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: SHOP_TIME_ZONE, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(new Date(at));
}

export function shopDayHeading(day: string, today = shopDay(new Date())): string {
  const yesterday = shopDay(new Date(new Date(`${today}T12:00:00+05:30`).getTime() - 86_400_000));
  const date = new Date(`${day}T12:00:00+05:30`);
  const long = new Intl.DateTimeFormat('en-IN', { timeZone: SHOP_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  if (day === today) return `Today — ${long}`;
  if (day === yesterday) return `Yesterday — ${long}`;
  return long;
}

/** The start and end of a shop day range as instants, for the server's `at` filter. */
export function shopDayBounds(from: string | null, to: string | null): { start: string | null; end: string | null } {
  const valid = (day: string | null) => (day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null);
  const start = valid(from);
  const end = valid(to);
  return {
    start: start ? new Date(`${start}T00:00:00+05:30`).toISOString() : null,
    end: end ? new Date(`${end}T23:59:59.999+05:30`).toISOString() : null,
  };
}

/** Text the server's `or()` search can take safely: PostgREST treats , ( ) as syntax and * % as
 *  wildcards, so those are dropped rather than escaped. */
export function searchTerm(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[,()*%\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export type LogRow = {
  id: string;
  at: string;
  actor_email: string;
  actor_name: string;
  action: string;
  entity: string;
  entity_id: string | null;
  summary: string;
  details: Record<string, unknown> | null;
  device: string | null;
  company_id: string;
};

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  // A cell starting = + - @ is run as a formula by Excel; a leading quote stops that.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The Log Book as a spreadsheet, India time, one row per entry. */
export function logBookCsv(rows: LogRow[]): string {
  const header = ['Date', 'Time', 'Who', 'Email', 'Device', 'What', 'Details', 'Reference'];
  const lines = rows.map((row) => [
    shopDay(row.at), shopTime(row.at), row.actor_name || row.actor_email, row.actor_email, row.device ?? '',
    actionLabel(row.action), row.summary, row.entity_id ?? '',
  ].map(csvCell).join(','));
  // The byte-order mark makes Excel read ₹ and Hindi names correctly.
  return '﻿' + [header.join(','), ...lines].join('\r\n') + '\r\n';
}
