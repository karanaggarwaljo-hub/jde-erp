import { getCurrentUser } from '@/lib/auth/dal';
import { insertAuditRow, listAuditRows } from '@/lib/db';

/**
 * Who changed what, and when.
 *
 * The Settings screen has carried an "Audit Logs" tab since the app was built, saying plainly that
 * nothing was being recorded. Nothing was. There was no way to establish who marked an invoice
 * paid, who moved a stock count, or when a supplier balance changed.
 *
 * One honest limitation, stated here rather than left to be discovered: an entry is written by the
 * route that performed the action, immediately after the database transaction has committed — not
 * inside it. The acting person is known only to the web server, and the database functions that do
 * the real work are called without it. So an entry cannot be forged from the browser, and it cannot
 * describe something that did not happen; but a server that died in the instant between the commit
 * and the log would leave a real change unrecorded. `recordAudit` never throws for the same reason:
 * a completed sale must not be reported as a failure because its log line could not be written.
 * Failures are logged to the server console, which is where a gap would be explained.
 */

export type AuditEntry = {
  companyId: string;
  /** Stable machine key: 'invoice.create', 'supplier.payment', 'part.delete'. */
  action: string;
  /** The table the action was about, in the app's own naming: 'invoices', 'products'. */
  entity: string;
  entityId?: string | null;
  /** The same thing in a sentence, written now, so the screen never has to reconstruct the wording
   *  for an old entry whose surrounding records have since changed. */
  summary: string;
  /** Anything worth keeping beyond the sentence — most usefully `before` and `after` when a figure
   *  changed. Keep it small; this is evidence, not a copy of the document. */
  details?: Record<string, unknown>;
};

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const actor = await getCurrentUser();
    await insertAuditRow({
      company_id: entry.companyId,
      // A route that somehow runs without a session still produces an entry, marked as such,
      // rather than none at all — an unattributed action is worth knowing about.
      actor_email: actor?.email ?? 'unknown',
      actor_name: actor?.name ?? '',
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entityId ?? null,
      summary: entry.summary,
      details: entry.details ?? null,
    });
  } catch (error) {
    console.error('Could not record an audit entry — the action itself already completed:', entry.action, error);
  }
}

export type AuditRow = {
  id: string;
  at: string;
  actor_email: string;
  actor_name: string;
  action: string;
  entity: string;
  entity_id: string | null;
  summary: string;
  details: Record<string, unknown> | null;
};

/** The most recent entries for one company, newest first. */
export async function recentAudit(companyId: string, limit = 200): Promise<AuditRow[]> {
  return (await listAuditRows(companyId, limit)) as AuditRow[];
}

/** Names a record the way the owner would name it, so an entry reads as a sentence about a part
 *  or a customer rather than about a row id. Falls back to the id when a row has no useful name —
 *  never to an empty string, which would read as though something anonymous had happened. */
export function describeRow(table: string, row: Record<string, unknown>): string {
  const text = (key: string) => (typeof row[key] === 'string' && row[key] ? String(row[key]) : '');
  const name = text('name') || text('email') || text('id') || 'a record';
  const noun: Record<string, string> = {
    products: 'the part',
    customers: 'the customer',
    suppliers: 'the supplier',
    users: 'the staff account',
    companies: 'the company',
    catalog_products: 'the catalogue listing',
    catalog_leads: 'the website enquiry from',
  };
  const partNumber = text('part_number');
  const label = table === 'products' && partNumber ? `${partNumber} ${name}` : name;
  return `${noun[table] ?? table} ${label}`.trim();
}

/** Just the named fields of a row. Keeps an entry to the figures that actually changed instead of
 *  a copy of the whole record, which would bury them. */
export function pick(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => key in row).map((key) => [key, row[key]]));
}

/** Formats an amount the way every screen in this app does, for use inside a summary sentence. */
export function money(amount: number): string {
  return `₹${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
