export type TableSchema = {
  primaryKey: string;
  /** When true, rows belong to a company (company_id column) and reads/writes are scoped to the active company. */
  companyScoped?: boolean;
  /**
   * When true, the browser may create, edit and delete these rows through /api/local/[table].
   *
   * This is an allowlist, and the default is no. Everything the business runs on — invoices and
   * their lines, purchase orders, goods received, stock batches and what consumed them, returns,
   * quotations, payments, write-offs — is a TRANSACTION: writing one row of it correctly means
   * writing several others in the same breath (stock drawn or put back, a balance moved, a
   * document numbered). Those writes go through their own routes, which call one database
   * function that does the whole thing or none of it.
   *
   * Left generic, a single PATCH could mark a purchase order paid without touching the payable,
   * or change an invoice total without the customer's balance following. The rows below are the
   * ones where a plain edit really is the whole change: names, prices, contact details, catalogue
   * copy — master data, not events that already happened.
   */
  writable?: boolean;
};

export const TABLES: Record<string, TableSchema> = {
  companies: { primaryKey: 'id', writable: true },
  products: { primaryKey: 'id', companyScoped: true, writable: true },
  customers: { primaryKey: 'id', companyScoped: true, writable: true },
  suppliers: { primaryKey: 'id', companyScoped: true, writable: true },
  invoices: { primaryKey: 'id', companyScoped: true },
  quotations: { primaryKey: 'id', companyScoped: true },
  purchase_orders: { primaryKey: 'id', companyScoped: true },
  grns: { primaryKey: 'id', companyScoped: true },
  invoice_items: { primaryKey: 'id', companyScoped: true },
  po_items: { primaryKey: 'id', companyScoped: true },
  expenses: { primaryKey: 'id', companyScoped: true },
  users: { primaryKey: 'email', companyScoped: true, writable: true },
  stock_layers: { primaryKey: 'id', companyScoped: true },
  stock_consumptions: { primaryKey: 'id', companyScoped: true },
  catalog_products: { primaryKey: 'id', companyScoped: true, writable: true },
  catalog_leads: { primaryKey: 'id', companyScoped: true, writable: true },
  catalog_events: { primaryKey: 'id', companyScoped: true },
  payments_received: { primaryKey: 'id', companyScoped: true },
  payment_allocations: { primaryKey: 'id', companyScoped: true },
  // Read-only for the Purchases screen's bill-matching worksheet, which has to show what was
  // credited back against each purchase. Writing one goes through jde_record_purchase_return.
  purchase_returns: { primaryKey: 'id', companyScoped: true },
  // Read-only for the Sales screen, so it can grey out Edit on an invoice that already has
  // goods back against it and say why, rather than letting the owner hit a database refusal.
  sales_returns: { primaryKey: 'id', companyScoped: true },
};

/**
 * Tables a restore needs that no screen ever reads.
 *
 * TABLES above is the browser-reachable surface — adding a table to it exposes that table
 * through /api/local/[table]. A backup has the opposite requirement: it has to carry everything,
 * whether or not a screen reads it. Sharing one list between the two meant a table could only be
 * backed up by also being published to the browser, so five never were.
 *
 * Every entry here is the detail behind a header that IS in TABLES. Without them a restore brings
 * back quotations and credit notes as headers with no lines, no purchase returns at all, and no
 * record of who was let off what — while reporting success, because the headers all arrived.
 * Found on 9 September 2026 by comparing the live database against a real snapshot; every one of
 * these tables had been missing from every backup ever taken.
 */
export const BACKUP_ONLY_TABLES: Record<string, TableSchema> = {
  quotation_items: { primaryKey: 'id', companyScoped: true },
  sales_return_items: { primaryKey: 'id', companyScoped: true },
  purchase_return_items: { primaryKey: 'id', companyScoped: true },
  // The settlement audit trail: WOFF-#### rows saying how much a customer was let off, when, and
  // why. The invoices themselves carry the amount, but only this says who decided it.
  invoice_writeoffs: { primaryKey: 'id', companyScoped: true },
  // SPAY-#### rows: what was actually paid to a supplier, when, and which purchase orders it was
  // put against. The orders carry their own paid amounts, but only these say that one payment
  // happened and covered them — the same reason the customer side keeps payments_received.
  supplier_payments: { primaryKey: 'id', companyScoped: true },
  supplier_payment_allocations: { primaryKey: 'id', companyScoped: true },
  // Who changed what, and when. Deliberately not in TABLES: the log records what everyone did, so
  // it is read through its own owner-only route rather than published to every logged-in browser.
  // A restore without it loses the evidence of everything that happened before the restore.
  audit_log: { primaryKey: 'id', companyScoped: true },
};

/**
 * jde_ tables deliberately left out of a backup, named so that "not in the list" can never again
 * be indistinguishable from "nobody noticed it". Both rebuild themselves from scratch:
 * ai_cache is stored AI answers, and adaptive_platform_outbox is a queue of events already sent.
 * Restoring either would be restoring stale work, not data.
 */
export const NOT_BACKED_UP = ['ai_cache', 'adaptive_platform_outbox'] as const;

/** Every table a restore has to put back. The superset the backup job walks. */
export const BACKUP_TABLES: Record<string, TableSchema> = { ...TABLES, ...BACKUP_ONLY_TABLES };

export type TableName = keyof typeof TABLES;

/** Whether /api/local/[table] may create, edit or delete rows of this table. See `writable` above:
 *  anything that is part of a transaction is deliberately absent, and stays read-only there. */
export function isWritableTable(table: TableName): boolean {
  // Defensive on a name that is not in TABLES at all: the routes reject those with a 404 before
  // reaching this, and a table that is only in BACKUP_ONLY_TABLES is not browser-reachable at
  // all, but "unknown" must never read as "writable".
  return Boolean(TABLES[table]?.writable);
}
