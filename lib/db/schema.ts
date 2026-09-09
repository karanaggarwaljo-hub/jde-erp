export type TableSchema = {
  primaryKey: string;
  /** When true, rows belong to a company (company_id column) and reads/writes are scoped to the active company. */
  companyScoped?: boolean;
};

export const TABLES: Record<string, TableSchema> = {
  companies: { primaryKey: 'id' },
  products: { primaryKey: 'id', companyScoped: true },
  customers: { primaryKey: 'id', companyScoped: true },
  suppliers: { primaryKey: 'id', companyScoped: true },
  invoices: { primaryKey: 'id', companyScoped: true },
  quotations: { primaryKey: 'id', companyScoped: true },
  purchase_orders: { primaryKey: 'id', companyScoped: true },
  grns: { primaryKey: 'id', companyScoped: true },
  invoice_items: { primaryKey: 'id', companyScoped: true },
  po_items: { primaryKey: 'id', companyScoped: true },
  expenses: { primaryKey: 'id', companyScoped: true },
  users: { primaryKey: 'email', companyScoped: true },
  stock_layers: { primaryKey: 'id', companyScoped: true },
  stock_consumptions: { primaryKey: 'id', companyScoped: true },
  catalog_products: { primaryKey: 'id', companyScoped: true },
  catalog_leads: { primaryKey: 'id', companyScoped: true },
  catalog_events: { primaryKey: 'id', companyScoped: true },
  payments_received: { primaryKey: 'id', companyScoped: true },
  payment_allocations: { primaryKey: 'id', companyScoped: true },
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
  purchase_returns: { primaryKey: 'id', companyScoped: true },
  purchase_return_items: { primaryKey: 'id', companyScoped: true },
  // The settlement audit trail: WOFF-#### rows saying how much a customer was let off, when, and
  // why. The invoices themselves carry the amount, but only this says who decided it.
  invoice_writeoffs: { primaryKey: 'id', companyScoped: true },
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
